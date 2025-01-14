# pyright: basic
"""add TaskAttempt

Revision ID: 6392770332cd
Revises: fc7c9d045329
Create Date: 2023-06-08 13:27:39.523827

"""
import uuid

import sqlalchemy as sa
import sqlmodel
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.sql.operators import is_
from transcribee_backend.config import settings
from transcribee_backend.helpers.time import now_tz_aware

# revision identifiers, used by Alembic.
revision = "6392770332cd"
down_revision = "fc7c9d045329"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        upgrade_with_autocommit()


def upgrade_with_autocommit() -> None:
    TaskAttempt = op.create_table(
        "taskattempt",
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("id", sa.Uuid, nullable=False),
        sa.Column("task_id", sa.Uuid, nullable=False),
        sa.Column("assigned_worker_id", sa.Uuid, nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("last_keepalive", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_worker_id"],
            ["worker.id"],
        ),
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("taskattempt", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_taskattempt_id"), ["id"], unique=False)

    with op.batch_alter_table("task", schema=None) as batch_op:
        batch_op.add_column(sa.Column("current_attempt_id", sa.Uuid, nullable=True))
        batch_op.add_column(
            sa.Column(
                "attempt_counter", sa.Integer(), nullable=True, server_default="0"
            )
        )
        taskstate_enum = sa.Enum(
            "NEW", "ASSIGNED", "COMPLETED", "FAILED", name="taskstate"
        )
        bind = batch_op.get_bind()
        taskstate_enum.create(bind=bind)
        batch_op.add_column(
            sa.Column(
                "state",
                taskstate_enum,
                nullable=False,
                server_default="NEW",
            )
        )
        batch_op.add_column(sa.Column("state_changed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(
            sa.Column("remaining_attempts", sa.Integer(), nullable=True)
        )
        batch_op.drop_constraint(
            "fk_task_assigned_worker_id_worker", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            None,  # type: ignore
            "taskattempt",
            ["current_attempt_id"],
            ["id"],
            ondelete="SET NULL",
            use_alter=True,
        )

    Task = sa.table(
        "task",
        sa.column("id", sa.Uuid),
        sa.column("assigned_at", sa.DateTime()),
        sa.column("last_keepalive", sa.DateTime()),
        sa.column("completed_at", sa.DateTime()),
        sa.column("is_completed", sa.Boolean()),
        sa.column("completion_data", sa.JSON()),
        sa.column("assigned_worker_id", sa.Uuid),
        sa.column("state_changed_at", sa.DateTime()),
        sa.column(
            "state",
            sa.Enum("NEW", "ASSIGNED", "COMPLETED", "FAILED", name="taskstate"),
        ),
        sa.column("remaining_attempts", sa.Integer()),
        sa.column("current_attempt_id", sa.Uuid),
        sa.column("progress", sa.Float()),
        sa.column("attempt_counter", sa.Integer()),
    )
    bind = op.get_bind()
    session = sqlmodel.Session(bind)
    for task in session.execute(
        Task.select().where(~is_(Task.c.assigned_worker_id, None))
    ).all():
        attempt_id = uuid.uuid4()
        session.execute(
            sqlmodel.insert(TaskAttempt).values(
                id=attempt_id,
                task_id=task.id,
                started_at=task.assigned_at,
                ended_at=task.completed_at,
                extra_data=task.completion_data,
                assigned_worker_id=task.assigned_worker_id,
                last_keepalive=task.last_keepalive,
                progress=task.progress,
                attempt_number=1,
            )
        )
        session.execute(
            sqlmodel.update(Task)
            .where(Task.c.id == task.id)
            .values(
                current_attempt_id=attempt_id,
                remaining_attempts=settings.task_attempt_limit - 1,
                state="ASSIGNED",
                attempt_counter=1,
            )
        )

    with op.batch_alter_table("task", schema=None) as batch_op:
        now = now_tz_aware()
        batch_op.execute(
            sqlmodel.update(Task)
            .where(Task.c.is_completed.is_(True))
            .values(state="COMPLETED", state_changed_at=Task.c.completed_at)
        )
        batch_op.execute(
            sqlmodel.update(Task)
            .where(Task.c.state_changed_at.is_(None))
            .values(state_changed_at=now)
        )
        batch_op.execute(
            sqlmodel.update(Task)
            .where(Task.c.remaining_attempts.is_(None))
            .values(remaining_attempts=settings.task_attempt_limit)
        )

    with op.batch_alter_table("task", schema=None) as batch_op:
        batch_op.drop_column("completed_at")
        batch_op.drop_column("is_completed")
        batch_op.drop_column("progress")
        batch_op.drop_column("last_keepalive")
        batch_op.drop_column("assigned_at")
        batch_op.drop_column("assigned_worker_id")
        batch_op.drop_column("completion_data")
        batch_op.alter_column(
            "state_changed_at", existing_type=sa.DATETIME(), nullable=False
        )
        batch_op.alter_column(
            "remaining_attempts", existing_type=sa.INTEGER(), nullable=False
        )
        batch_op.alter_column(
            "attempt_counter", existing_type=sa.INTEGER(), nullable=False
        )


def downgrade() -> None:
    raise NotImplementedError()
