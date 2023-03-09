import itertools
from typing import Iterator, List, Literal

from pydantic import BaseModel


class Atom(BaseModel):
    text: str
    start: float # in ms
    end: float # in ms
    conf: float # confidence ~ logit probability


class Paragraph(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    speaker: str
    children: List[Atom]

    def text(self) -> str:
        return "".join(a.text for a in self.children)

    def start(self) -> None | float:
        if len(self.children) > 0:
            return self.children[0].start

    def end(self) -> None | float:
        if len(self.children) > 0:
            return self.children[-1].end


class Document(BaseModel):
    lang: str
    paragraphs: List[Paragraph]

    def text(self) -> str:
        return "".join(p.text() for p in self.paragraphs)

    def start(self) -> None | float:
        if len(self.paragraphs) > 0:
            return self.paragraphs[0].start()

    def end(self) -> None | float:
        if len(self.paragraphs) > 0:
            return self.paragraphs[-1].end()

    def iter_atoms(self) -> Iterator[Atom]:
        return itertools.chain.from_iterable(p.children for p in self.paragraphs)


UNKNOWN_SPEAKER = "Speaker 1"
