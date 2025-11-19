import datetime
import enum
import pathlib
import uuid
from dataclasses import dataclass
from typing import Annotated, Callable, List, Optional

import magic
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Path,
    Query,
    UploadFile,
    WebSocket,
    WebSocketException,
    status,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, TypeAdapter
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.expression import desc
from sqlmodel import Session, col, select
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import DocumentMedia, ExportTaskParameters
from transcribee_proto.api import DocumentWithAccessInfo as ApiDocumentWithAccessInfo

from transcribee_backend.auth import (
    generate_share_token,
    get_authorized_worker,
    validate_share_authorization,
    validate_user_authorization,
    validate_worker_authorization,
)
from transcribee_backend.config import settings
from transcribee_backend.db import (
    get_redis_task_channel,
    get_session,
    get_session_ws,
)
from transcribee_backend.helpers.sync import DocumentSyncConsumer
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.document import (
    ApiDocumentWithTasks,
    DocumentShareTokenBase,
)
from transcribee_backend.models.task import TaskAttempt, TaskResponse
from transcribee_backend.util.redis_task_channel import RedisTaskChannel

from .. import media_storage
from ..models import (
    Document,
    DocumentMediaFile,
    DocumentMediaTag,
    DocumentShareToken,
    Task,
    TaskType,
    UserToken,
    Worker,
)
from .user import get_user_token

document_router = APIRouter()


class AuthLevel(enum.IntEnum):
    READ_ONLY = 1
    READ_WRITE = 2
    WORKER = 3
    FULL = 4


@dataclass
class AuthInfo:
    document: Document
    auth_level: AuthLevel


def get_user_auth_info(
    doc: Document, session: Session, authorization: str
) -> Optional[AuthInfo]:
    try:
        user_token = validate_user_authorization(session, authorization)
    except HTTPException:
        return

    if doc.user_id == user_token.user_id:
        return AuthInfo(document=doc, auth_level=AuthLevel.FULL)


def get_worker_auth_info(
    doc: Document, session: Session, authorization: str
) -> Optional[AuthInfo]:
    try:
        worker = validate_worker_authorization(session, authorization)
    except HTTPException:
        return

    statement = select(Task).where(
        col(Task.current_attempt).has(TaskAttempt.assigned_worker_id == worker.id),
        Task.document_id == doc.id,
    )
    if session.exec(statement.limit(1)).one_or_none() is not None:
        return AuthInfo(document=doc, auth_level=AuthLevel.WORKER)


def get_shared_auth_info(
    doc: Document, session: Session, share_token: str
) -> Optional[AuthInfo]:
    try:
        token = validate_share_authorization(session, share_token, document_id=doc.id)
    except HTTPException:
        token = None
        return

    if doc.id == token.document_id:
        return AuthInfo(
            document=doc,
            auth_level=AuthLevel.READ_WRITE if token.can_write else AuthLevel.READ_ONLY,
        )


class DocumentDoesNotExist(Exception):
    pass


def get_auth_info(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(default=None),
    share_token: Optional[str] = Header(default=None, alias="Share-Token"),
    allow_worker=False,
) -> Optional[AuthInfo]:
    """Checks the provided credentials and returns the auth info with the highest privilege"""
    statement = select(Document).where(Document.id == document_id)
    doc = session.exec(statement).one_or_none()
    if doc is None:
        raise DocumentDoesNotExist()

    auth_infos = []

    if authorization is not None:
        auth_info = get_user_auth_info(
            doc=doc, session=session, authorization=authorization
        )
        if auth_info is not None:
            auth_infos.append(auth_info)

    if authorization is not None and allow_worker:
        auth_info = get_worker_auth_info(
            doc=doc, session=session, authorization=authorization
        )
        if auth_info is not None:
            auth_infos.append(auth_info)

    if share_token is not None:
        auth_info = get_shared_auth_info(
            doc=doc, session=session, share_token=share_token
        )
        if auth_info is not None:
            auth_infos.append(auth_info)

    if not auth_infos:
        return None

    return max(auth_infos, key=lambda x: x.auth_level)


def get_doc_auth_function(
    min_auth_level: AuthLevel,
    allow_worker: bool,
    max_auth_level: AuthLevel = AuthLevel.FULL,
):
    def func(
        document_id: uuid.UUID,
        session: Session = Depends(get_session),
        authorization: Optional[str] = Header(default=None),
        share_token: Optional[str] = Header(default=None, alias="Share-Token"),
    ):
        try:
            auth_info = get_auth_info(
                document_id=document_id,
                session=session,
                authorization=authorization,
                share_token=share_token,
                allow_worker=allow_worker,
            )
        except DocumentDoesNotExist:
            raise HTTPException(status_code=404)

        if auth_info is None:
            raise HTTPException(status_code=403)
        if auth_info.auth_level < min_auth_level:
            raise HTTPException(status_code=403)
        if auth_info.auth_level > max_auth_level:
            raise HTTPException(status_code=403)

        return auth_info

    return func


def auth_fn_to_ws(f: Callable):
    def func(
        document_id: uuid.UUID,
        session: Session = Depends(get_session_ws),
        authorization: Optional[str] = Query(default=None),
        share_token: Optional[str] = Query(default=None, alias="share_token"),
    ):
        try:
            return f(
                document_id=document_id,
                session=session,
                authorization=authorization,
                share_token=share_token,
            )
        except HTTPException:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)

    return func


get_doc_full_auth = get_doc_auth_function(
    min_auth_level=AuthLevel.FULL, allow_worker=False
)
get_doc_worker_auth = get_doc_auth_function(
    min_auth_level=AuthLevel.WORKER, max_auth_level=AuthLevel.WORKER, allow_worker=True
)
get_doc_min_readwrite_auth = get_doc_auth_function(
    min_auth_level=AuthLevel.READ_WRITE, allow_worker=False
)
get_doc_min_readonly_auth = get_doc_auth_function(
    min_auth_level=AuthLevel.READ_ONLY, allow_worker=False
)
get_doc_min_readonly_or_worker_auth = get_doc_auth_function(
    min_auth_level=AuthLevel.READ_ONLY, allow_worker=True
)
ws_get_doc_min_readonly_or_worker_auth = auth_fn_to_ws(
    get_doc_min_readonly_or_worker_auth
)


def get_task_worker_reencode_auth(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
) -> Task:
    statement = select(Task).where(
        Task.document_id == document_id, Task.task_type == TaskType.REENCODE
    )
    task = session.exec(statement).one_or_none()
    if (
        task is None
        or task.current_attempt is None
        or task.current_attempt.assigned_worker != authorized_worker
    ):
        raise HTTPException(status_code=404)
    return task


def create_default_tasks_for_document(
    session: Session,
    document: Document,
    model: str,
    language: str,
    number_of_speakers: int | None,
):
    reencode_task = Task(
        task_type=TaskType.REENCODE,
        task_parameters={},
        document_id=document.id,
    )
    session.add(reencode_task)

    transcribe_task = Task(
        task_type=TaskType.TRANSCRIBE,
        task_parameters={"lang": language, "model": model},
        document_id=document.id,
        dependencies=[reencode_task],
    )
    session.add(transcribe_task)

    if number_of_speakers != 0 and number_of_speakers != 1:
        speaker_identification_task = Task(
            task_type=TaskType.IDENTIFY_SPEAKERS,
            task_parameters={"number_of_speakers": number_of_speakers},
            document_id=document.id,
            dependencies=[transcribe_task],
        )
        session.add(speaker_identification_task)


class TranscriptionModel(str, enum.Enum):
    tiny = "tiny"
    base = "base"
    small = "small"
    large = "large"


languages = "auto,en,zh,de,es,ru,ko,fr,ja,pt,tr,pl,ca,nl,ar,sv,it,id,hi,fi,vi,he,uk,el,ms,cs,\
ro,da,hu,ta,no,th,ur,hr,bg,lt,la,mi,ml,cy,sk,te,fa,lv,bn,sr,az,sl,kn,et,mk,br,eu,is,hy,ne,mn,bs,\
kk,sq,sw,gl,mr,pa,si,km,sn,yo,so,af,oc,ka,be,tg,sd,gu,am,yi,lo,uz,fo,ht,ps,tk,nn,mt,sa,lb,my,\
bo,tl,mg,as,tt,haw,ln,ha,ba,jw,su,yue".split(
    ","
)


@document_router.post("/")
async def create_document(
    name: str = Form(),
    model: TranscriptionModel = Form(),
    language: str = Form(),
    number_of_speakers: Optional[Annotated[int, Path(ge=0)]] = Form(None),
    file: UploadFile = File(),
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> ApiDocument:
    if language not in languages:
        raise RequestValidationError(
            [
                ValueError(f"Unknown language: '{language}'"),
                ("body", "language"),
            ]
        )

    document = Document(
        name=name,
        user_id=token.user_id,
        created_at=now_tz_aware(),
        changed_at=now_tz_aware(),
    )

    session.add(document)

    stored_file = media_storage.store_file(file.file)
    file.file.seek(0)

    media_file = DocumentMediaFile(
        created_at=now_tz_aware(),
        changed_at=now_tz_aware(),
        document_id=document.id,
        file=stored_file,
        content_type=magic.from_descriptor(file.file.fileno(), mime=True),
    )

    session.add(media_file)

    tag = DocumentMediaTag(media_file_id=media_file.id, tag="original")
    session.add(tag)

    create_default_tasks_for_document(
        session, document, model, language, number_of_speakers
    )

    session.commit()
    return document.as_api_document()


@document_router.post("/import/")
def import_document(
    media_file: UploadFile = File(),
    token: UserToken = Depends(get_user_token),
    session: Session = Depends(get_session),
    name: str = Form(),
) -> ApiDocument:
    document = Document(
        name=name,
        user_id=token.user_id,
        created_at=now_tz_aware(),
        changed_at=now_tz_aware(),
    )

    session.add(document)

    stored_file = media_storage.store_file(media_file.file)
    media_file.file.seek(0)

    db_media_file = DocumentMediaFile(
        created_at=now_tz_aware(),
        changed_at=now_tz_aware(),
        document_id=document.id,
        file=stored_file,
        content_type=magic.from_descriptor(media_file.file.fileno(), mime=True),
    )

    session.add(db_media_file)

    tag = DocumentMediaTag(media_file_id=db_media_file.id, tag="original")
    session.add(tag)

    reencode_task = Task(
        task_type=TaskType.REENCODE,
        task_parameters={},
        document_id=document.id,
    )
    session.add(reencode_task)

    session.commit()
    return document.as_api_document()


@document_router.get("/")
def list_documents(
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> List[ApiDocumentWithTasks]:
    statement = (
        select(Document)
        .where(Document.user == token.user)
        .order_by(desc(Document.changed_at), Document.id)
        .options(
            selectinload(Document.tasks).selectinload(Task.dependency_links),
            selectinload(Document.media_files).selectinload(DocumentMediaFile.tags),
        )
    )
    results = session.exec(statement)
    return [doc.as_api_document() for doc in results]


@document_router.get("/{document_id}/")
def get_document(
    auth: AuthInfo = Depends(get_doc_min_readonly_auth),
) -> ApiDocumentWithAccessInfo:
    return ApiDocumentWithAccessInfo(
        **dict(auth.document.as_api_document()),
        can_write=auth.auth_level >= AuthLevel.READ_WRITE,
        has_full_access=auth.auth_level >= AuthLevel.FULL,
    )


@document_router.get("/{document_id}/media_files/")
def get_document_media(
    auth: AuthInfo = Depends(get_doc_min_readonly_auth),
) -> List[DocumentMedia]:
    return auth.document.as_api_document().media_files


@document_router.delete("/{document_id}/")
def delete_document(
    auth: AuthInfo = Depends(get_doc_full_auth),
    session: Session = Depends(get_session),
) -> None:
    paths_to_delete: List[pathlib.Path] = []
    media_files = select(DocumentMediaFile).where(
        DocumentMediaFile.document == auth.document
    )

    for media_file in session.exec(media_files):
        paths_to_delete.append(settings.storage_path / media_file.file)
        session.delete(media_file)

    session.delete(auth.document)
    session.commit()

    for path in paths_to_delete:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    return


@document_router.get("/{document_id}/tasks/")
def get_document_tasks(
    auth: AuthInfo = Depends(get_doc_min_readonly_auth),
    session: Session = Depends(get_session),
) -> List[TaskResponse]:
    statement = (
        select(Task)
        .where(Task.document_id == auth.document.id)
        .options(selectinload(Task.dependency_links))
    )
    return [TaskResponse.from_orm(x) for x in session.exec(statement)]


@document_router.websocket("/sync/{document_id}/")
async def websocket_endpoint(
    websocket: WebSocket,
    auth: AuthInfo = Depends(ws_get_doc_min_readonly_or_worker_auth),
    session: Session = Depends(get_session_ws),
):
    connection = DocumentSyncConsumer(
        document=auth.document,
        websocket=websocket,
        session=session,
        can_write=auth.auth_level >= AuthLevel.READ_WRITE,
    )
    await connection.run()


@document_router.post("/{document_id}/add_media_file/")
def add_media_file(
    task: Task = Depends(get_task_worker_reencode_auth),
    tags: list[str] = Form(),
    file: UploadFile = File(),
    session: Session = Depends(get_session),
) -> ApiDocument:
    stored_file = media_storage.store_file(file.file)
    file.file.seek(0)

    media_file = DocumentMediaFile(
        created_at=now_tz_aware(),
        changed_at=now_tz_aware(),
        document_id=task.document_id,
        file=stored_file,
        content_type=magic.from_descriptor(file.file.fileno(), mime=True),
    )

    session.add(media_file)

    for tag_str in tags:
        tag = DocumentMediaTag(media_file_id=media_file.id, tag=tag_str)
        session.add(tag)

    session.commit()
    return media_file.document.as_api_document()


class SetDurationRequest(BaseModel):
    duration: float


@document_router.post("/{document_id}/set_duration/")
def set_duration(
    body: SetDurationRequest,
    task: Task = Depends(get_task_worker_reencode_auth),
    session: Session = Depends(get_session),
) -> ApiDocument:
    doc = task.document
    doc.duration = body.duration
    session.add(doc)
    session.commit()

    return doc.as_api_document()


class DocumentUpdateRequest(BaseModel):
    name: Optional[str] = None


@document_router.patch("/{document_id}/")
def update_document(
    update: DocumentUpdateRequest,
    auth: AuthInfo = Depends(get_doc_full_auth),
    session: Session = Depends(get_session),
) -> ApiDocument:
    update_dict = update.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(auth.document, key, value)
    session.add(auth.document)
    session.commit()

    return auth.document.as_api_document()


class CreateShareToken(BaseModel):
    name: str
    valid_until: Optional[datetime.datetime] = None
    can_write: bool


@document_router.post("/{document_id}/share_tokens/")
def share(
    body: CreateShareToken,
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
    auth: AuthInfo = Depends(get_doc_full_auth),
) -> DocumentShareTokenBase:
    db_token = generate_share_token(
        document_id=auth.document.id,
        name=body.name,
        valid_until=body.valid_until,
        can_write=body.can_write,
    )
    session.add(db_token)
    session.commit()
    session.refresh(db_token)
    return db_token


@document_router.get("/{document_id}/share_tokens/")
def list_share_tokens(
    session: Session = Depends(get_session),
    auth: AuthInfo = Depends(get_doc_full_auth),
) -> List[DocumentShareTokenBase]:
    statement = (
        select(DocumentShareToken)
        .where(DocumentShareToken.document_id == auth.document.id)
        .order_by(desc(DocumentShareToken.valid_until), DocumentShareToken.id)
    )
    results = session.exec(statement)
    return list(results)


@document_router.delete("/{document_id}/share_tokens/{token_id}/")
def delete_share_tokens(
    token_id: uuid.UUID,
    session: Session = Depends(get_session),
    auth: AuthInfo = Depends(get_doc_full_auth),
):
    statement = select(DocumentShareToken).where(
        DocumentShareToken.document_id == auth.document.id,
        DocumentShareToken.id == token_id,
    )
    token = session.exec(statement).one_or_none()
    if token is None:
        raise HTTPException(status_code=404)
    else:
        session.delete(token)
        session.commit()
        return


class ExportResult(BaseModel):
    result: str


class ExportError(BaseModel):
    error: str


ExportRes = ExportResult | ExportError


@document_router.get("/{document_id}/export/", response_class=PlainTextResponse)
async def export(
    export_parameters: ExportTaskParameters = Depends(),
    auth: AuthInfo = Depends(get_doc_min_readonly_auth),
    redis_task_channel: RedisTaskChannel = Depends(get_redis_task_channel),
    session: Session = Depends(get_session),
):
    export_task = Task(
        task_type=TaskType.EXPORT,
        task_parameters=export_parameters.model_dump(),
        document_id=auth.document.id,
    )
    session.add(export_task)
    session.commit()

    result = TypeAdapter(ExportRes).validate_json(
        await redis_task_channel.wait_for_result(str(export_task.id))
    )
    if isinstance(result, ExportError):
        raise Exception(result.error)
    else:
        return result.result


@document_router.post("/{document_id}/add_export_result/")
async def add_export_result(
    result: ExportRes,
    task_id: str,
    auth: AuthInfo = Depends(get_doc_worker_auth),
    redis_task_channel: RedisTaskChannel = Depends(get_redis_task_channel),
) -> None:
    await redis_task_channel.put_result(task_id, result.model_dump_json())
