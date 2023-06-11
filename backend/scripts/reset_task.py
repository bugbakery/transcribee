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
    args = parser.parse_args()
    with SessionContextManager() as session:
        task = session.exec(
            update(Task)
            .where(
                or_(Task.id == args.uuid, Task.document_id == args.uuid),
                Task.state == TaskState.FAILED,
            )
            .values(state=TaskState.NEW, remaining_attempts=settings.task_attempt_limit)
        )
        session.commit()
