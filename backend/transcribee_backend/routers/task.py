import datetime
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import aliased
from sqlalchemy.sql.operators import is_
from sqlmodel import Session, col, or_, select
from transcribee_backend.auth import get_authorized_worker
from transcribee_backend.config import settings
from transcribee_backend.db import get_session
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_proto.api import KeepaliveBody

from ..models import (
    AssignedTaskResponse,
    CreateTask,
    Document,
    Task,
    TaskDependency,
    TaskResponse,
    TaskType,
    UserToken,
    Worker,
)
from .user import get_user_token

task_router = APIRouter()


@task_router.post("/")
def create_task(
    task: CreateTask,
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> TaskResponse:
    db_task = Task.from_orm(task)
    session.add(db_task)
    session.commit()
    session.refresh(db_task)
    return TaskResponse.from_orm(db_task)


@task_router.post("/claim_unassigned_task/")
def claim_unassigned_task(
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
    task_type: List[TaskType] = Query(),
) -> Optional[AssignedTaskResponse]:
    taskalias = aliased(Task)
    blocking_tasks_exist = (
        select(TaskDependency)
        .join(
            taskalias,
            taskalias.id == TaskDependency.dependant_on_id,
        )
        .where(
            is_(taskalias.is_completed, False),
            Task.id == TaskDependency.dependent_task_id,
        )
    ).exists()

    statement = (
        select(Task)
        .where(
            col(Task.task_type).in_(task_type),
            or_(
                is_(Task.assigned_worker_id, None),
                col(Task.last_keepalive)
                < now_tz_aware() - datetime.timedelta(seconds=settings.worker_timeout),
            ),
            is_(Task.is_completed, False),
            ~blocking_tasks_exist,
        )
        .with_for_update()
    )
    task = session.exec(statement).first()
    if task is None:
        return task
    task.assigned_worker = authorized_worker
    task.last_keepalive = now_tz_aware()
    task.assigned_at = now_tz_aware()
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.post("/{task_id}/keepalive/")
def keepalive(
    task_id: uuid.UUID,
    keepalive_data: KeepaliveBody = Body(),
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
) -> Optional[AssignedTaskResponse]:
    statement = select(Task).where(Task.id == task_id)
    task = session.exec(statement).one_or_none()
    if task is None:
        raise HTTPException(status_code=404)

    if task.assigned_worker != authorized_worker:
        raise HTTPException(status_code=403)

    task.last_keepalive = now_tz_aware()
    if keepalive_data.progress:
        task.progress = keepalive_data.progress
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.post("/{task_id}/mark_completed/")
def mark_completed(
    task_id: uuid.UUID,
    completion_data: Dict,
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
) -> Optional[AssignedTaskResponse]:
    statement = select(Task).where(Task.id == task_id)
    task = session.exec(statement).one_or_none()
    if task is None:
        raise HTTPException(status_code=404)

    if task.assigned_worker != authorized_worker:
        raise HTTPException(status_code=403)

    task.is_completed = True
    task.completed_at = now_tz_aware()
    task.completion_data = completion_data
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.get("/")
def list_tasks(
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> List[TaskResponse]:
    statement = select(Task).join(Document).where(Document.user == token.user)
    results = session.exec(statement)
    return [TaskResponse.from_orm(x) for x in results]
