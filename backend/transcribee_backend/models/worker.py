import uuid
from typing import Optional

from pydantic.types import AwareDatetime
from sqlmodel import DateTime, Field, SQLModel


class WorkerBase(SQLModel):
    name: str

    last_seen: Optional[AwareDatetime] = Field(sa_type=DateTime(timezone=True))
    deactivated_at: Optional[AwareDatetime] = Field(sa_type=DateTime(timezone=True))


class WorkerWithId(WorkerBase):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )


class Worker(WorkerWithId, table=True):
    token: str
