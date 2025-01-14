from __future__ import annotations

import enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel


class TaskType(str, enum.Enum):
    IDENTIFY_SPEAKERS = "IDENTIFY_SPEAKERS"
    TRANSCRIBE = "TRANSCRIBE"
    ALIGN = "ALIGN"
    REENCODE = "REENCODE"
    EXPORT = "EXPORT"


class DocumentMedia(BaseModel):
    url: str
    content_type: str
    tags: List[str]


class Document(BaseModel):
    id: UUID
    name: str
    created_at: str
    changed_at: str
    media_files: List[DocumentMedia]


class DocumentWithAccessInfo(Document):
    can_write: bool
    has_full_access: bool


class TaskBase(BaseModel):
    id: UUID
    document: Document
    task_type: TaskType


class SpeakerIdentificationTaskParameters(BaseModel):
    number_of_speakers: int | None = None


class SpeakerIdentificationTask(TaskBase):
    task_type: Literal[TaskType.IDENTIFY_SPEAKERS] = TaskType.IDENTIFY_SPEAKERS
    task_parameters: SpeakerIdentificationTaskParameters


class TranscribeTaskParameters(BaseModel):
    lang: str
    model: str


class ExportFormat(str, enum.Enum):
    VTT = "VTT"
    SRT = "SRT"


class ExportTaskParameters(BaseModel):
    format: ExportFormat
    include_speaker_names: bool
    include_word_timing: bool
    max_line_length: int | None = None


class TranscribeTask(TaskBase):
    task_type: Literal[TaskType.TRANSCRIBE] = TaskType.TRANSCRIBE
    task_parameters: TranscribeTaskParameters


class AlignTask(TaskBase):
    task_type: Literal[TaskType.ALIGN] = TaskType.ALIGN
    task_parameters: Dict[str, Any]


class ReencodeTask(TaskBase):
    task_type: Literal[TaskType.REENCODE] = TaskType.REENCODE
    task_parameters: Dict[str, Any]


class ExportTask(TaskBase):
    task_type: Literal[TaskType.EXPORT] = TaskType.EXPORT
    task_parameters: ExportTaskParameters


AssignedTask = (
    SpeakerIdentificationTask | TranscribeTask | AlignTask | ReencodeTask | ExportTask
)


class LoginResponse(BaseModel):
    token: str


class KeepaliveBody(BaseModel):
    progress: Optional[float] = None
