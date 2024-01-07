import argparse
import uuid

from sqlmodel import or_, update
from transcribee_backend.config import settings
from transcribee_backend.db import SessionContextManager
from transcribee_backend.models.task import Task, TaskState

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--uuid", required=True, type=uuid.UUID, help="Task UUID or Document UUID"
    )
    parser.add_argument(
        "--state",
        type=TaskState,
        choices=list(TaskState),
        default=TaskState.FAILED,
        help="State of tasks to reset",
    )
    args = parser.parse_args()
    with SessionContextManager(path="management_command:reset_task") as session:
        task = session.execute(
            update(Task)
            .where(
                or_(Task.id == args.uuid, Task.document_id == args.uuid),
                Task.state == args.state,
            )
            .values(state=TaskState.NEW, remaining_attempts=settings.task_attempt_limit)
        )
        session.commit()
