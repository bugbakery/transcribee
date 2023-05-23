import datetime
import uuid
from pathlib import Path
from typing import List, Optional

import magic
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketException,
    status,
)
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from pydantic.error_wrappers import ErrorWrapper
from sqlalchemy.sql.expression import desc
from sqlmodel import Session, col, select
from transcribee_proto.api import Document as ApiDocument

from transcribee_backend.auth import (
    generate_share_token,
    get_authorized_worker,
    validate_share_authorization,
    validate_user_authorization,
    validate_worker_authorization,
)
from transcribee_backend.config import get_model_config, settings
from transcribee_backend.db import get_session
from transcribee_backend.helpers.sync import DocumentSyncConsumer
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models import DocumentShareToken, DocumentShareTokenResponse
from transcribee_backend.models.task import TaskAttempt, TaskResponse

from .. import media_storage
from ..models import (
    Document,
    DocumentMediaFile,
    DocumentMediaTag,
    Task,
    TaskType,
    UserToken,
    Worker,
)
from .user import get_user_token

document_router = APIRouter()


def get_document_from_url(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    authorization: str = Header(),
) -> Document:
    """
    Get the current document from the `document_id` url parameter, ensuring that the authorized user
    is allowed to access the document or a share token for the document is present.
    """
    try:
        user_token = validate_user_authorization(session, authorization)
    except HTTPException:
        user_token = None

    try:
        share_token = validate_share_authorization(session, authorization)
    except HTTPException:
        share_token = None

    if share_token is not None:
        auth_filter = Document.id == share_token.document_id
    elif user_token is not None:
        auth_filter = Document.user_id == user_token.user_id
    else:
        raise HTTPException(status_code=403)

    statement = select(Document).where(Document.id == document_id, auth_filter)
    doc = session.exec(statement).one_or_none()
    if doc is not None:
        return doc
    else:
        raise HTTPException(status_code=404)


def get_owned_document_from_url(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    authorization: str = Header(),
) -> Document:
    """
    Get the current document from the `document_id` url parameter, ensuring that the authorized user
    is allowed to access the document or a share token for the document is present.
    """
    user_token = validate_user_authorization(session, authorization)
    statement = select(Document).where(
        Document.id == document_id, Document.user_id == user_token.user_id
    )
    doc = session.exec(statement).one_or_none()
    if doc is not None:
        return doc
    else:
        raise HTTPException(status_code=404)


def ws_get_document_from_url(
    document_id: uuid.UUID,
    authorization: str = Query(),
    session: Session = Depends(get_session),
):
    """
    Get the current document from a websocket url (using the `document_id` url parameter), ensuring
    that an authorization query parameter is set and the user / worker can acccess the document.
    """
    statement = select(Document).where(Document.id == document_id)
    document = session.exec(statement).one_or_none()
    if document is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)

    try:
        user_token = validate_user_authorization(session, authorization)
    except HTTPException:
        user_token = None

    try:
        worker = validate_worker_authorization(session, authorization)
    except HTTPException:
        worker = None

    try:
        share_token = validate_share_authorization(session, authorization)
    except HTTPException:
        share_token = None

    if user_token is not None and user_token.user_id == document.user_id:
        return document
    if worker is not None:
        statement = select(Task).where(
            col(Task.current_attempt).has(TaskAttempt.assigned_worker_id == worker.id),
            Task.document_id == document.id,
        )
        if session.exec(statement.limit(1)).one_or_none() is not None:
            return document
    if share_token is not None and document.id == share_token.document_id:
        return document
    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)


def create_default_tasks_for_document(
    session: Session, document: Document, model: str, language: str
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

    align_task = Task(
        task_type=TaskType.ALIGN,
        task_parameters={},
        document_id=document.id,
        dependencies=[transcribe_task],
    )
    session.add(align_task)

    speaker_identification_task = Task(
        task_type=TaskType.IDENTIFY_SPEAKERS,
        task_parameters={},
        document_id=document.id,
        dependencies=[align_task],
    )
    session.add(speaker_identification_task)


@document_router.post("/")
async def create_document(
    name: str = Form(),
    model: str = Form(),
    language: str = Form(),
    file: UploadFile = File(),
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> ApiDocument:
    model_configs = get_model_config()

    if model not in model_configs:
        raise RequestValidationError(
            [ErrorWrapper(ValueError(f"Unknown model '{model}'"), ("body", "model"))]
        )

    if language not in model_configs[model].languages:
        raise RequestValidationError(
            [
                ErrorWrapper(
                    ValueError(
                        f"Model '{model}' does not support language '{language}'"
                    ),
                    ("body", "language"),
                )
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

    create_default_tasks_for_document(session, document, model, language)

    session.commit()
    return document.as_api_document()


@document_router.get("/")
def list_documents(
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> List[ApiDocument]:
    statement = (
        select(Document)
        .where(Document.user == token.user)
        .order_by(desc(Document.changed_at), Document.id)
    )
    results = session.exec(statement)
    return [doc.as_api_document() for doc in results]


@document_router.get("/{document_id}/")
def get_document(
    document: Document = Depends(get_document_from_url),
) -> ApiDocument:
    return document.as_api_document()


@document_router.delete("/{document_id}/")
def delete_document(
    document: Document = Depends(get_owned_document_from_url),
    session: Session = Depends(get_session),
) -> None:
    paths_to_delete: List[Path] = []
    media_files = select(DocumentMediaFile).where(
        DocumentMediaFile.document == document
    )

    for media_file in session.exec(media_files):
        paths_to_delete.append(settings.storage_path / media_file.file)
        session.delete(media_file)

    session.delete(document)
    session.commit()

    for path in paths_to_delete:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    return


@document_router.get("/{document_id}/tasks/")
def get_document_tasks(
    document: Document = Depends(get_document_from_url),
    session: Session = Depends(get_session),
) -> List[TaskResponse]:
    statement = select(Task).where(Task.document_id == document.id)
    return [TaskResponse.from_orm(x) for x in session.exec(statement)]


@document_router.websocket("/sync/{document_id}/")
async def websocket_endpoint(
    websocket: WebSocket,
    document: Document = Depends(ws_get_document_from_url),
    session: Session = Depends(get_session),
):
    connection = DocumentSyncConsumer(
        document=document, websocket=websocket, session=session
    )
    await connection.run()


@document_router.post("/{document_id}/add_media_file/")
def add_media_file(
    document_id: uuid.UUID,
    tags: list[str] = Form(),
    file: UploadFile = File(),
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
) -> ApiDocument:
    statement = select(Task).where(
        Task.document_id == document_id,
        Task.task_type == TaskType.REENCODE,
    )
    task = session.exec(statement).one_or_none()
    if (
        task is None
        or task.current_attempt is None
        or task.current_attempt.assigned_worker != authorized_worker
    ):
        raise HTTPException(status_code=404)

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
    document_id: uuid.UUID,
    body: SetDurationRequest,
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
) -> ApiDocument:
    statement = select(Task).where(
        Task.document_id == document_id,
        Task.task_type == TaskType.REENCODE,
    )
    task = session.exec(statement).one_or_none()
    if (
        task is None
        or task.current_attempt is None
        or task.current_attempt.assigned_worker != authorized_worker
    ):
        raise HTTPException(status_code=404)

    doc = task.document
    doc.duration = body.duration
    session.add(doc)
    session.commit()

    return doc.as_api_document()


class DocumentUpdate(BaseModel):
    name: Optional[str] = None


@document_router.patch("/{document_id}/")
def update_document(
    update: DocumentUpdate,
    document: Document = Depends(get_document_from_url),
    session: Session = Depends(get_session),
) -> ApiDocument:
    update_dict = update.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(document, key, value)
    session.add(document)
    session.commit()

    return document.as_api_document()


class ShareDocumentResponse(BaseModel):
    share_token: str


class CreateShareToken(BaseModel):
    name: str
    valid_until: Optional[datetime.datetime]


@document_router.post("/{document_id}/share_tokens/")
def share(
    body: CreateShareToken,
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
    document: Document = Depends(get_owned_document_from_url),
) -> ShareDocumentResponse:
    share_token, db_token = generate_share_token(
        user_id=token.user.id,
        document_id=document.id,
        name=body.name,
        valid_until=body.valid_until,
    )
    session.add(db_token)
    session.commit()
    return ShareDocumentResponse(share_token=share_token)


@document_router.get("/{document_id}/share_tokens/")
def list_share_tokens(
    session: Session = Depends(get_session),
    document: Document = Depends(get_owned_document_from_url),
) -> List[DocumentShareTokenResponse]:
    statement = (
        select(DocumentShareToken)
        .where(DocumentShareToken.document_id == document.id)
        .order_by(desc(DocumentShareToken.valid_until), DocumentShareToken.id)
    )
    results = session.exec(statement)
    return [x.to_response() for x in results]


@document_router.delete("/{document_id}/share_tokens/{token_id}/")
def delete_share_tokens(
    token_id: uuid.UUID,
    session: Session = Depends(get_session),
    document: Document = Depends(get_owned_document_from_url),
):
    statement = select(DocumentShareToken).where(
        DocumentShareToken.document_id == document.id,
        DocumentShareToken.id == token_id,
    )
    token = session.exec(statement).one_or_none()
    if token is None:
        raise HTTPException(status_code=404)
    else:
        session.delete(token)
        session.commit()
        return
