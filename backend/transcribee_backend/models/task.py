import datetime
import enum
import uuid
from typing import Any, Dict, List, Literal, Optional

from sqlmodel import JSON, Column, Field, ForeignKey, Relationship, SQLModel, col
from sqlmodel.sql.sqltypes import GUID
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import TaskType
from typing_extensions import Self

from transcribee_backend.config import settings
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.document import Document
from transcribee_backend.models.worker import Worker


class TaskState(enum.Enum):
    NEW = "NEW"
    ASSIGNED = "ASSIGNED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class TaskBase(SQLModel):
    task_type: TaskType
    task_parameters: dict
    document_id: uuid.UUID


class TaskDependency(SQLModel, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )

    dependent_task_id: uuid.UUID = Field(
        sa_column=Column(GUID, ForeignKey("task.id", ondelete="CASCADE")),
        unique=False,
    )
    dependant_on_id: uuid.UUID = Field(
        sa_column=Column(GUID, ForeignKey("task.id", ondelete="CASCADE")),
        unique=False,
    )


class Task(TaskBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    document_id: uuid.UUID = Field(
        sa_column=Column(GUID, ForeignKey("document.id", ondelete="CASCADE")),
        unique=False,
    )
    document: Document = Relationship(back_populates="tasks")

    task_parameters: dict = Field(sa_column=Column(JSON(), nullable=False))

    state: TaskState = TaskState.NEW
    state_changed_at: datetime.datetime = Field(default_factory=now_tz_aware)

    attempts: List["TaskAttempt"] = Relationship(
        sa_relationship_kwargs={
            "cascade": "all,delete",
            "primaryjoin": "TaskAttempt.task_id == Task.id",
        },
    )

    current_attempt_id: Optional[uuid.UUID] = Field(
        sa_column=Column(
            GUID, ForeignKey("taskattempt.id", ondelete="SET NULL", use_alter=True)
        ),
        default=None,
    )
    current_attempt: Optional["TaskAttempt"] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "Task.current_attempt_id == TaskAttempt.id",
            "post_update": True,
        }
    )

    attempt_counter: int = 0
    remaining_attempts: int = Field(default=settings.task_attempt_limit)

    dependencies: List["Task"] = Relationship(
        back_populates="dependants",
        link_model=TaskDependency,
        sa_relationship_kwargs={
            "primaryjoin": "Task.id==TaskDependency.dependent_task_id",
            "secondaryjoin": "Task.id==TaskDependency.dependant_on_id",
        },
    )
    dependency_links: List[TaskDependency] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "Task.id==TaskDependency.dependent_task_id",
            "viewonly": True,
        },
    )
    dependants: List["Task"] = Relationship(
        back_populates="dependencies",
        link_model=TaskDependency,
        sa_relationship_kwargs={
            "primaryjoin": "Task.id==TaskDependency.dependant_on_id",
            "secondaryjoin": "Task.id==TaskDependency.dependent_task_id",
        },
    )


class TaskAttempt(SQLModel, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )

    task_id: uuid.UUID = Field(
        sa_column=Column(
            GUID, ForeignKey(col(Task.id), ondelete="CASCADE"), nullable=False
        ),
        unique=False,
    )
    task: Task = Relationship(
        back_populates="attempts",
        sa_relationship_kwargs={
            "primaryjoin": "TaskAttempt.task_id == Task.id",
        },
    )

    assigned_worker_id: Optional[uuid.UUID] = Field(
        foreign_key="worker.id", default=None
    )
    assigned_worker: Optional[Worker] = Relationship()

    attempt_number: int
    started_at: Optional[datetime.datetime] = None
    last_keepalive: Optional[datetime.datetime] = None
    ended_at: Optional[datetime.datetime] = None

    progress: Optional[float] = None

    extra_data: Optional[dict] = Field(
        sa_column=Column(JSON(), nullable=True), default=None
    )


class TaskAttemptResponse(SQLModel):
    progress: Optional[float]


class TaskResponse(TaskBase):
    id: uuid.UUID
    state: TaskState
    dependencies: List[uuid.UUID]
    current_attempt: Optional[TaskAttemptResponse]

    @classmethod
    def from_orm(cls, task: Task, update={}) -> Self:
        # The following code is equivalent to this:
        #     return super().from_orm(
        #         task,
        #         update={
        #             "dependencies": [x.dependant_on_id for x in task.dependency_links],
        #             **update,
        #         },
        #     )
        # But much faster, because from_orm destructures the `obj` to mix it
        # with the `update` dict, which causes an access to all attributes,
        # including `dependencies`/`dependents` which are then all seperately
        # selected from the database, causing many query
        # Even with a small number of document this cuts the loading time of
        # the `/api/v1/documents/` endpoint roughly in half on my test machine
        return cls(
            id=task.id,
            state=task.state,
            dependencies=[x.dependant_on_id for x in task.dependency_links],
            current_attempt=None,
            document_id=task.document_id,
            task_type=task.task_type,
            task_parameters=task.task_parameters,
            **update,
        )


class AssignedTaskResponse(TaskResponse):
    document: ApiDocument

    @classmethod
    def from_orm(cls, task: Task) -> Self:
        return super().from_orm(
            task,
            update={
                "document": task.document.as_api_document(),
            },
        )


# TODO: Better typing, combine with types from proto
class SpeakerIdentificationTask(TaskBase):
    task_type: Literal[TaskType.IDENTIFY_SPEAKERS] = TaskType.IDENTIFY_SPEAKERS
    task_parameters: Dict[str, Any]


class TranscribeTaskParameters(SQLModel):
    lang: str
    model: str


class TranscribeTask(TaskBase):
    task_type: Literal[TaskType.TRANSCRIBE] = TaskType.TRANSCRIBE
    task_parameters: TranscribeTaskParameters


class AlignTask(TaskBase):
    task_type: Literal[TaskType.ALIGN] = TaskType.ALIGN
    task_parameters: Dict[str, Any]


class UnknownTask(TaskBase):
    task_type: str
    task_parameters: Dict[str, Any]


CreateTask = SpeakerIdentificationTask | TranscribeTask | AlignTask | UnknownTask
