import datetime
import uuid

from sqlmodel import Column, DateTime, Field, Relationship, SQLModel


class UserBase(SQLModel):
    username: str = Field(sa_column_kwargs={"unique": True})


class User(UserBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    password_hash: bytes
    password_salt: bytes


class CreateUser(UserBase):
    password: str


class UserTokenBase(SQLModel):
    pass


class UserToken(UserTokenBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    user_id: uuid.UUID = Field(foreign_key="user.id")
    user: User = Relationship()
    token_hash: bytes
    token_salt: bytes
    valid_until: datetime.datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
