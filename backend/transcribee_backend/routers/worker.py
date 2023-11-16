from fastapi import APIRouter, Depends
from sqlmodel import Session
from sqlmodel.main import SQLModel

from transcribee_backend.auth import (
    create_worker,
    get_api_token,
)
from transcribee_backend.db import get_session
from transcribee_backend.models import (
    ApiToken,
)
from transcribee_backend.models.worker import Worker

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
