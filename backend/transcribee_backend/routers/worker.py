import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select
from sqlmodel.main import SQLModel

from transcribee_backend.auth import create_worker, get_api_token
from transcribee_backend.db import get_session
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models import ApiToken
from transcribee_backend.models.worker import Worker, WorkerWithId

worker_router = APIRouter()


class CreateWorker(SQLModel):
    name: str


class DeactivateWorker(SQLModel):
    id: uuid.UUID


@worker_router.post("/create/")
def create_worker_endpoint(
    worker: CreateWorker,
    session: Session = Depends(get_session),
    _token: ApiToken = Depends(get_api_token),
) -> Worker:
    return create_worker(session=session, name=worker.name)


@worker_router.get("/")
def list_workers(
    session: Session = Depends(get_session),
    _token: ApiToken = Depends(get_api_token),
) -> List[WorkerWithId]:
    statement = select(Worker).where(col(Worker.deactivated_at).is_(None))
    return [
        WorkerWithId(
            name=worker.name,
            last_seen=worker.last_seen,
            id=worker.id,
            deactivated_at=worker.deactivated_at,
        )
        for worker in session.exec(statement).all()
    ]


@worker_router.post("/deactivate/")
def deactivate_worker_endpoint(
    body: DeactivateWorker,
    session: Session = Depends(get_session),
    _token: ApiToken = Depends(get_api_token),
) -> None:
    query = select(Worker).where(
        Worker.id == body.id, col(Worker.deactivated_at).is_(None)
    )
    result = session.exec(query).one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Worker not found.")

    result.deactivated_at = now_tz_aware()
    session.add(result)
    session.commit()
