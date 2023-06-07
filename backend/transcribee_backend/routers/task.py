import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import aliased
from sqlalchemy.sql.operators import is_
from sqlmodel import Session, col, or_, select
from transcribee_backend.auth import get_authorized_task, get_authorized_worker
from transcribee_backend.config import settings
from transcribee_backend.db import get_session
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.task import TaskState
from transcribee_proto.api import KeepaliveBody

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


def finish_current_attempt(
    session: Session, task: Task, now: Optional[datetime.datetime] = None
):
    if now is None:
        now = now_tz_aware()
    attempt = task.current_attempt
    if attempt is not None:
        attempt.ended_at = now
        session.add(attempt)


def mark_task_as_failed(session: Session, task: Task, now: datetime.datetime):
    task.state = TaskState.FAILED
    task.state_changed_at = now
    finish_current_attempt(session, task, now)
    session.add(task)


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
            or_(
                is_(Task.current_attempt_id, None),
                Task.current_attempt.has(
                    TaskAttempt.last_keepalive
                    < now_tz_aware()
                    - datetime.timedelta(seconds=settings.worker_timeout)
                ),
            ),
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
    while True:
        task = get_ready_task(session, task_type)
        if task is None:
            session.commit()  # We might have marked tasks as failed
            return
        elif task.remaining_attempts <= 0:
            mark_task_as_failed(session, task, now)
        else:
            break

    finish_current_attempt(session, task, now=now)
    attempt = TaskAttempt(
        task=task,
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
) -> Optional[AssignedTaskResponse]:
    task.current_attempt.last_keepalive = now_tz_aware()
    if keepalive_data.progress:
        task.current_attempt.progress = keepalive_data.progress
        session.add(task.current_attempt)
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.post("/{task_id}/mark_completed/")
def mark_completed(
    extra_data: Dict,
    session: Session = Depends(get_session),
    task: Task = Depends(get_authorized_task),
    now: datetime.datetime = Depends(now_tz_aware),
) -> Optional[AssignedTaskResponse]:
    task.current_attempt.ended_at = now
    task.current_attempt.last_keepalive = now
    task.current_attempt.extra_data = extra_data
    session.add(task.current_attempt)
    task.state = TaskState.COMPLETED
    task.state_changed_at = now
    session.add(task)
    session.commit()
    return AssignedTaskResponse.from_orm(task)


@task_router.post("/{task_id}/mark_failed/")
def mark_failed(
    extra_data: Dict,
    session: Session = Depends(get_session),
    task: Task = Depends(get_authorized_task),
    now: datetime.datetime = Depends(now_tz_aware),
) -> Optional[AssignedTaskResponse]:
    now = now_tz_aware()

    task.current_attempt.ended_at = now
    task.current_attempt.last_keepalive = now
    task.current_attempt.extra_data = extra_data
    task.state = TaskState.NEW
    task.state_changed_at = now
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
