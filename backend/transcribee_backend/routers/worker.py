from typing import List

from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from sqlmodel.main import SQLModel

from transcribee_backend.auth import (
    create_worker,
    get_api_token,
)
from transcribee_backend.db import get_session
from transcribee_backend.models import (
    ApiToken,
)
from transcribee_backend.models.worker import Worker, WorkerBase

worker_router = APIRouter()


class CreateWorker(SQLModel):
    name: str


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
) -> List[WorkerBase]:
    statement = select(Worker)
    return [
        WorkerBase(name=worker.name, last_seen=worker.last_seen)
        for worker in session.exec(statement).all()
    ]
