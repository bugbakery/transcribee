import datetime
import uuid
from typing import Any, Dict, List, Literal, Optional

from sqlmodel import JSON, Column, Field, Relationship, SQLModel
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import TaskType
from typing_extensions import Self

from .document import Document
from .worker import Worker, WorkerBase


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
    dependent_task_id: uuid.UUID = Field(foreign_key="task.id", unique=False)
    dependant_on_id: uuid.UUID = Field(foreign_key="task.id", unique=False)


class Task(TaskBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    document_id: uuid.UUID = Field(foreign_key="document.id")
    document: Document = Relationship()

    progress: Optional[float] = None

    assigned_worker_id: Optional[uuid.UUID] = Field(
        foreign_key="worker.id", default=None
    )
    assigned_worker: Optional[Worker] = Relationship()
    assigned_at: Optional[datetime.datetime] = None
    last_keepalive: Optional[datetime.datetime] = None
    task_parameters: dict = Field(sa_column=Column(JSON(), nullable=False))

    is_completed: bool = Field(default=False)
    completed_at: Optional[datetime.datetime] = None
    completion_data: Optional[Dict] = Field(sa_column=Column(JSON(), nullable=True))

    dependencies: List["Task"] = Relationship(
        back_populates="dependants",
        link_model=TaskDependency,
        sa_relationship_kwargs={
            "primaryjoin": "Task.id==TaskDependency.dependent_task_id",
            "secondaryjoin": "Task.id==TaskDependency.dependant_on_id",
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


class TaskResponse(TaskBase):
    id: uuid.UUID
    document: ApiDocument
    progress: Optional[float]
    is_completed: bool
    completed_at: Optional[datetime.datetime] = None
    assigned_at: Optional[datetime.datetime] = None
    dependencies: List["TaskResponse"]

    @classmethod
    def from_orm(cls, task: Task) -> Self:
        return super().from_orm(
            task,
            update={
                "document": task.document.as_api_document(),
                "dependencies": [TaskResponse.from_orm(x) for x in task.dependencies],
            },
        )


class AssignedTaskResponse(TaskResponse):
    assigned_worker: WorkerBase
    last_keepalive: datetime.datetime


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
