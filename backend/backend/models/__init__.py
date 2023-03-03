from sqlmodel import SQLModel, Field, Column, VARCHAR
import uuid
import datetime


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


class UserToken(SQLModel, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    user_id: uuid.UUID = Field(foreign_key="user.id")
    token_hash: bytes
    token_salt: bytes
    valid_until: datetime.datetime
