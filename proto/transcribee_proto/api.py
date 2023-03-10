from __future__ import annotations

import enum
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel


class TaskType(str, enum.Enum):
    DIARIZE = "DIARIZE"
    TRANSCRIBE = "TRANSCRIBE"
    ALIGN = "ALIGN"


class Document(BaseModel):
    id: str
    name: str
    audio_file: Optional[str]
    created_at: str
    changed_at: str


class TaskBase(BaseModel):
    id: str
    document: Document
    task_type: TaskType


class DiarizeTask(TaskBase):
    task_type: Literal[TaskType.DIARIZE] = TaskType.DIARIZE
    task_parameters: Dict[str, Any]


class TranscribeTaskParameters(BaseModel):
    lang: str
    model: str


class TranscribeTask(TaskBase):
    task_type: Literal[TaskType.TRANSCRIBE] = TaskType.TRANSCRIBE
    task_parameters: TranscribeTaskParameters


class AlignTask(TaskBase):
    task_type: Literal[TaskType.ALIGN] = TaskType.ALIGN
    task_parameters: Dict[str, Any]


AssignedTask = DiarizeTask | TranscribeTask | AlignTask
