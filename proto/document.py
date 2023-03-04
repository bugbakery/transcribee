from typing import List, Literal

from pydantic import BaseModel


class TranscriptSegment(BaseModel):
    text: str
    start: float
    end: float
    conf: float


class Paragraph(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    speaker: str
    children: List[TranscriptSegment]


class Document(BaseModel):
    __root__: List[Paragraph]
