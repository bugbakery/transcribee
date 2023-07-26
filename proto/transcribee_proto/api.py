from __future__ import annotations

import enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class TaskType(str, enum.Enum):
    IDENTIFY_SPEAKERS = "IDENTIFY_SPEAKERS"
    TRANSCRIBE = "TRANSCRIBE"
    ALIGN = "ALIGN"
    REENCODE = "REENCODE"


class DocumentMedia(BaseModel):
    url: str
    content_type: str
    tags: List[str]


class Document(BaseModel):
    id: str
    name: str
    created_at: str
    changed_at: str
    media_files: List[DocumentMedia]


class TaskBase(BaseModel):
    id: str
    document: Document
    task_type: TaskType


class SpeakerIdentificationTaskParameters(BaseModel):
    number_of_speakers: int | None


class SpeakerIdentificationTask(TaskBase):
    task_type: Literal[TaskType.IDENTIFY_SPEAKERS] = TaskType.IDENTIFY_SPEAKERS
    task_parameters: SpeakerIdentificationTaskParameters


class TranscribeTaskParameters(BaseModel):
    lang: str
    model: str


class TranscribeTask(TaskBase):
    task_type: Literal[TaskType.TRANSCRIBE] = TaskType.TRANSCRIBE
    task_parameters: TranscribeTaskParameters


class AlignTask(TaskBase):
    task_type: Literal[TaskType.ALIGN] = TaskType.ALIGN
    task_parameters: Dict[str, Any]


class ReencodeTask(TaskBase):
    task_type: Literal[TaskType.REENCODE] = TaskType.REENCODE
    task_parameters: Dict[str, Any]


AssignedTask = SpeakerIdentificationTask | TranscribeTask | AlignTask | ReencodeTask


class LoginResponse(BaseModel):
    token: str


class KeepaliveBody(BaseModel):
    progress: Optional[float]
