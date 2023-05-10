import uuid
from typing import List

import magic
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketException,
    status,
)
from pydantic import BaseModel
from sqlalchemy.sql.expression import desc
from sqlmodel import Session, select
from transcribee_backend.auth import (
    get_authorized_worker,
    validate_user_authorization,
    validate_worker_authorization,
)
from transcribee_backend.db import get_session
from transcribee_backend.helpers.sync import DocumentSyncConsumer
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.task import TaskResponse
from transcribee_proto.api import Document as ApiDocument

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


def create_default_tasks_for_document(session: Session, document: Document):
    reencode_task = Task(
        task_type=TaskType.REENCODE,
        task_parameters={},
        document_id=document.id,
    )
    session.add(reencode_task)

    transcribe_task = Task(
        task_type=TaskType.TRANSCRIBE,
        task_parameters={"lang": "auto", "model": "base"},
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
    file: UploadFile = File(),
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> ApiDocument:
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

    create_default_tasks_for_document(session, document)

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


def get_document_from_url(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> Document:
    statement = select(Document).where(Document.id == document_id)
    doc = session.exec(statement).one_or_none()
    if doc is not None:
        return doc
    else:
        raise HTTPException(status_code=404)


@document_router.get("/{document_id}/")
def get_document(
    token: UserToken = Depends(get_user_token),
    document: Document = Depends(get_document_from_url),
) -> ApiDocument:
    return document.as_api_document()


@document_router.get("/{document_id}/tasks/")
def get_document_tasks(
    token: UserToken = Depends(get_user_token),
    document: Document = Depends(get_document_from_url),
    session: Session = Depends(get_session),
) -> List[TaskResponse]:
    statement = select(Task).where(Task.document_id == document.id)
    return [TaskResponse.from_orm(x) for x in session.exec(statement)]


def can_access_document(
    authorization: str = Query(),
    document: Document = Depends(get_document_from_url),
    session: Session = Depends(get_session),
):
    try:
        user_token = validate_user_authorization(session, authorization)
    except HTTPException:
        user_token = None

    try:
        worker = validate_worker_authorization(session, authorization)
    except HTTPException:
        worker = None

    if user_token is not None and user_token.user_id == document.user_id:
        return document
    if worker is not None:
        statement = select(Task).where(
            Task.assigned_worker_id == worker.id, Task.document_id == document.id
        )
        if session.exec(statement.limit(1)).one_or_none() is not None:
            return document
    raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)


@document_router.websocket("/sync/{document_id}/")
async def websocket_endpoint(
    websocket: WebSocket,
    document: Document = Depends(can_access_document),
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
        Task.document_id == document_id, Task.task_type == TaskType.REENCODE
    )
    task = session.exec(statement).one_or_none()
    if task is None:
        raise HTTPException(status_code=403)

    if task.assigned_worker != authorized_worker:
        raise HTTPException(status_code=403)

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
        Task.document_id == document_id, Task.task_type == TaskType.REENCODE
    )
    task = session.exec(statement).one_or_none()
    if task is None:
        raise HTTPException(status_code=403)

    if task.assigned_worker != authorized_worker:
        raise HTTPException(status_code=403)

    doc = task.document
    doc.duration = body.duration
    session.add(doc)
    session.commit()

    return doc.as_api_document()
