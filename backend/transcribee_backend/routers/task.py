import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Query
from fastapi.exceptions import HTTPException
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.sql.operators import is_
from sqlmodel import Session, col, select
from transcribee_proto.api import KeepaliveBody

from transcribee_backend.auth import get_authorized_task, get_authorized_worker
from transcribee_backend.db import get_session
from transcribee_backend.helpers.tasks import finish_current_attempt
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.task import TaskState

from ..models import (
    AssignedTaskResponse,
    CreateTask,
    Document,
    Task,
    TaskAttempt,
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
    return TaskResponse.from_orm(db_task)


def get_ready_task(session: Session, task_type: List[TaskType]) -> Optional[Task]:
    taskalias = aliased(Task)
    blocking_tasks_exist = (
        select(TaskDependency)
        .join(
            taskalias,
            taskalias.id == TaskDependency.dependant_on_id,
        )
        .where(
            taskalias.state != TaskState.COMPLETED,
            Task.id == TaskDependency.dependent_task_id,
        )
    ).exists()

    statement = (
        select(Task)
        .where(
            col(Task.task_type).in_(task_type),
            is_(Task.current_attempt_id, None),
            ~(col(Task.state).in_([TaskState.COMPLETED, TaskState.FAILED])),
            ~blocking_tasks_exist,
        )
        .with_for_update()
    )
    return session.exec(statement).first()


@task_router.post("/claim_unassigned_task/")
def claim_unassigned_task(
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
    task_type: List[TaskType] = Query(),
    now: datetime.datetime = Depends(now_tz_aware),
) -> Optional[AssignedTaskResponse]:
    task = get_ready_task(session, task_type)
    if task is None:
        return

    attempt = TaskAttempt(
        task_id=task.id,
        started_at=now,
        assigned_worker=authorized_worker,
        last_keepalive=now,
        attempt_number=task.attempt_counter + 1,
    )
    session.add(attempt)
    task.current_attempt = attempt
    task.attempt_counter += 1
    task.remaining_attempts -= 1
    task.state = TaskState.ASSIGNED
    task.state_changed_at = now
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.post("/{task_id}/keepalive/")
def keepalive(
    keepalive_data: KeepaliveBody = Body(),
    session: Session = Depends(get_session),
    task: Task = Depends(get_authorized_task),
):
    # mostly to please the type checker, get_authorized_task already ensures
    # that the task has a current attempt
    if task.current_attempt is None:
        raise HTTPException(status_code=500)
    task.current_attempt.last_keepalive = now_tz_aware()
    if keepalive_data.progress:
        task.current_attempt.progress = keepalive_data.progress
        session.add(task.current_attempt)
    session.add(task)
    session.commit()


@task_router.post("/{task_id}/mark_completed/")
def mark_completed(
    extra_data: Dict,
    session: Session = Depends(get_session),
    task: Task = Depends(get_authorized_task),
    now: datetime.datetime = Depends(now_tz_aware),
):
    finish_current_attempt(
        session=session, task=task, now=now, extra_data=extra_data, successful=True
    )


@task_router.post("/{task_id}/mark_failed/")
def mark_failed(
    extra_data: Dict,
    session: Session = Depends(get_session),
    task: Task = Depends(get_authorized_task),
    now: datetime.datetime = Depends(now_tz_aware),
):
    now = now_tz_aware()

    finish_current_attempt(
        session=session, task=task, now=now, extra_data=extra_data, successful=False
    )


@task_router.get("/")
def list_tasks(
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> List[TaskResponse]:
    statement = (
        select(Task)
        .join(Document)
        .where(Document.user == token.user)
        .options(selectinload(Task.dependency_links))
    )
    results = session.exec(statement)
    return [TaskResponse.from_orm(x) for x in results]
