import datetime
import uuid
from typing import List, Optional

from sqlmodel import Column, DateTime, Field, Relationship, SQLModel
from transcribee_backend import media_storage
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import DocumentMedia as ApiDocumentMedia

from .user import User


class DocumentBase(SQLModel):
    name: str
    duration: Optional[float] = None  # In seconds


class Document(DocumentBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        primary_key=True,
        index=True,
        nullable=False,
    )
    user_id: uuid.UUID = Field(foreign_key="user.id")
    user: User = Relationship()
    created_at: datetime.datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    changed_at: datetime.datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    media_files: List["DocumentMediaFile"] = Relationship()

    def as_api_document(self) -> ApiDocument:
        return ApiDocument(
            id=str(self.id),
            name=self.name,
            created_at=self.created_at.isoformat(),
            changed_at=self.created_at.isoformat(),
            media_files=[
                media_file.as_api_media_file() for media_file in self.media_files
            ],
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
    created_at: datetime.datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    changed_at: datetime.datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )

    document: Document = Relationship(back_populates="media_files")
    document_id: uuid.UUID = Field(foreign_key="document.id")

    file: str
    content_type: str
    tags: List["DocumentMediaTag"] = Relationship()

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
    document: Document = Relationship()
