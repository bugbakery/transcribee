import uuid
from typing import List, Optional

from pydantic.types import AwareDatetime
from sqlmodel import DateTime, Field, Relationship, SQLModel
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import DocumentMedia as ApiDocumentMedia

from transcribee_backend import media_storage


class DocumentBase(SQLModel):
    name: str
    duration: Optional[float] = None  # In seconds


class ApiDocumentWithTasks(ApiDocument):
    tasks: List["TaskResponse"]


class Document(DocumentBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    user_id: uuid.UUID = Field(foreign_key="user.id")
    user: "User" = Relationship()
    created_at: AwareDatetime = Field(sa_type=DateTime(timezone=True))
    changed_at: AwareDatetime = Field(sa_type=DateTime(timezone=True))
    media_files: List["DocumentMediaFile"] = Relationship()
    updates: List["DocumentUpdate"] = Relationship(
        sa_relationship_kwargs={"cascade": "all"}
    )
    share_tokens: List["DocumentShareToken"] = Relationship(
        sa_relationship_kwargs={"cascade": "all"}
    )
    tasks: List["Task"] = Relationship(sa_relationship_kwargs={"cascade": "all"})

    def as_api_document(self) -> ApiDocumentWithTasks:
        tasks = [TaskResponse.from_orm(task) for task in self.tasks]
        return ApiDocumentWithTasks(
            id=str(self.id),
            name=self.name,
            created_at=self.created_at.isoformat(),
            changed_at=self.created_at.isoformat(),
            media_files=[
                media_file.as_api_media_file() for media_file in self.media_files
            ],
            tasks=tasks,
        )


class DocumentMediaFileBase(SQLModel):
    pass


class DocumentMediaFile(DocumentMediaFileBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    created_at: AwareDatetime = Field(sa_type=DateTime(timezone=True))
    changed_at: AwareDatetime = Field(sa_type=DateTime(timezone=True))

    document: Document = Relationship(back_populates="media_files")
    document_id: uuid.UUID = Field(foreign_key="document.id")

    file: str
    content_type: str
    tags: List["DocumentMediaTag"] = Relationship(
        sa_relationship_kwargs={"cascade": "all"}
    )

    def as_api_media_file(self) -> ApiDocumentMedia:
        return ApiDocumentMedia(
            url=media_storage.get_media_url(self.file),
            tags=[tag.tag for tag in self.tags],
            content_type=self.content_type,
        )


class DocumentMediaTag(SQLModel, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    tag: str
    media_file_id: uuid.UUID = Field(foreign_key="documentmediafile.id")
    media_file: DocumentMediaFile = Relationship(back_populates="tags")


class DocumentUpdateBase(SQLModel):
    change_bytes: bytes


class DocumentUpdate(DocumentUpdateBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    document_id: uuid.UUID = Field(foreign_key="document.id")
    document: Document = Relationship(back_populates="updates")


class DocumentShareTokenBase(SQLModel):
    id: uuid.UUID
    name: str
    valid_until: Optional[AwareDatetime] = Field(sa_type=DateTime(timezone=True))
    document_id: uuid.UUID = Field(foreign_key="document.id")
    token: str
    can_write: bool


class DocumentShareToken(DocumentShareTokenBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    document: Document = Relationship(back_populates="share_tokens")


# Import here to break circular dependency

from .task import Task, TaskResponse  # noqa: E402
from .user import User  # noqa: E402

ApiDocumentWithTasks.model_rebuild()
Document.model_rebuild()
