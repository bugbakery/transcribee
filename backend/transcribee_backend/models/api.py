import uuid

from sqlmodel import Field, SQLModel


class ApiTokenBase(SQLModel):
    id: uuid.UUID
    name: str


class ApiToken(ApiTokenBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    token: str
