from typing import List, Literal

from pydantic import BaseModel


class Token(BaseModel):
    text: str
    start: float
    end: float
    conf: float


class Paragraph(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    speaker: str
    children: List[Token]


class Document(BaseModel):
    __root__: List[Paragraph]


UNKNOWN_SPEAKER = "Speaker 1"
