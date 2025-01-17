from sqlmodel import or_, update
from transcribee_backend.admin_cli.command import Command
from transcribee_backend.config import settings
from transcribee_backend.db import SessionContextManager
from transcribee_backend.models.task import Task, TaskState


class ResetTaskCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument("--uuid", required=True)
        parser.add_argument(
            "--state",
            type=TaskState,
            choices=list(TaskState),
            default=TaskState.FAILED,
        )

    def run(self, args):
        with SessionContextManager(path="management_command:reset_task") as session:
            session.execute(
                update(Task)
                .where(
                    or_(Task.id == args.uuid, Task.document_id == args.uuid),
                    Task.state == args.state,
                )
                .values(
                    state=TaskState.NEW, remaining_attempts=settings.task_attempt_limit
                )
            )
            session.commit()
