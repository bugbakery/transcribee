from sqlmodel import SQLModel, Field, Column, VARCHAR
import uuid


class UserBase(SQLModel):
    username: str = Field(sa_column_kwargs={"unique": True})


class User(UserBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    password: str
