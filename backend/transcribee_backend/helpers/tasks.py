import datetime
from typing import Iterable, Optional

from sqlmodel import Session, select, col
from transcribee_backend.config import settings
from transcribee_backend.db import SessionContextManager
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.task import Task, TaskAttempt, TaskState


def finish_current_attempt(
    session: Session,
    task: Task,
    successful: bool,
    now: Optional[datetime.datetime] = None,
    extra_data: Optional[dict] = None,
):
    if now is None:
        now = now_tz_aware()

    if task.current_attempt is None:
        return

    task.current_attempt.ended_at = now
    task.current_attempt.last_keepalive = now
    task.current_attempt.extra_data = extra_data
    session.add(task.current_attempt)
    task.current_attempt = None

    if successful:
        task.state = TaskState.COMPLETED
    elif task.remaining_attempts > 0:
        task.state = TaskState.NEW
    else:
        task.state = TaskState.FAILED

    task.state_changed_at = now

    session.add(task)
    session.commit()

    session.add(task)


def timeouted_tasks(session: Session) -> Iterable[Task]:
    statement = (
        select(Task)
        .where(
            col(Task.current_attempt).has(
                col(TaskAttempt.last_keepalive)
                < now_tz_aware() - datetime.timedelta(seconds=settings.worker_timeout)
            ),
        )
        .with_for_update()
    )
    return session.exec(statement).all()


def timeout_attempts():
    now = now_tz_aware()
    with SessionContextManager() as session:
        for task in timeouted_tasks(session):
            finish_current_attempt(
                session=session, task=task, now=now, successful=False
            )
        session.commit()
