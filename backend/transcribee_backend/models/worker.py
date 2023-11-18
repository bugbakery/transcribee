import datetime
import uuid
from typing import Optional

from sqlmodel import Column, DateTime, Field, SQLModel


class WorkerBase(SQLModel):
    name: str

    last_seen: Optional[datetime.datetime] = Field(
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    deactivated_at: Optional[datetime.datetime] = Field(
        sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class WorkerWithId(WorkerBase):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )


class Worker(WorkerWithId, table=True):
    token: str
