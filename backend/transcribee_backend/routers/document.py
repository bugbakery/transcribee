import datetime
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
from sqlmodel import Session, select
from transcribee_backend.auth import (
    validate_user_authorization,
    validate_worker_authorization,
)
from transcribee_backend.db import get_session
from transcribee_backend.helpers.sync import DocumentSyncConsumer
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
)
from .user import get_user_token

document_router = APIRouter()


def now_tz_aware() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def create_default_tasks_for_document(session: Session, document: Document):
    diarize_task = Task(
        task_type=TaskType.DIARIZE,
        task_parameters={},
        document_id=document.id,
    )
    session.add(diarize_task)
    session.commit()
    session.refresh(diarize_task)

    transcribe_task = Task(
        task_type=TaskType.TRANSCRIBE,
        task_parameters={"lang": "auto", "model": "base"},
        document_id=document.id,
    )
    session.add(transcribe_task)
    session.commit()
    session.refresh(transcribe_task)

    align_task = Task(
        task_type=TaskType.ALIGN,
        task_parameters={},
        document_id=document.id,
        dependencies=[diarize_task, transcribe_task],
    )
    session.add(align_task)
    session.commit()
    session.refresh(align_task)


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
    session.commit()
    session.refresh(document)

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
    session.commit()
    session.refresh(media_file)

    tag = DocumentMediaTag(media_file_id=media_file.id, tag="original")
    session.add(tag)
    session.commit()
    session.refresh(tag)

    create_default_tasks_for_document(session, document)
    return document.as_api_document()


@document_router.get("/")
def list_documents(
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> List[ApiDocument]:
    statement = select(Document).where(Document.user == token.user)
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
