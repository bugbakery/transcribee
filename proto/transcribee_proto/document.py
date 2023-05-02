import itertools
from typing import Iterator, List, Literal, Mapping, Optional, Tuple

from pydantic import BaseModel, Field


class Atom(BaseModel):
    text: str
    start: float  # in seconds
    end: float  # in seconds
    conf: float  # confidence ~ logit probability
    conf_ts: float  # timestamp confidence


class Paragraph(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    speaker: Optional[int] = None
    alternative_speakers: List[int] = Field(default_factory=list)
    children: List[Atom]
    lang: str

    def text(self) -> str:
        return "".join(a.text for a in self.children)

    def start(self) -> Optional[float]:
        if len(self.children) > 0:
            return self.children[0].start

    def end(self) -> Optional[float]:
        if len(self.children) > 0:
            return self.children[-1].end


class Segment(BaseModel):
    start: float  # in seconds
    end: float  # in seconds
    speakers: List[int]


class Document(BaseModel):
    speaker_names: Optional[Mapping[int, str]]
    children: List[Paragraph]
    version: int = 1

    def iter_lang_blocks(self) -> Iterator[Tuple[str, List[Atom]]]:
        atoms = []
        lang = None
        for paragraph in self.children:
            if lang is None:
                lang = paragraph.lang
                atoms = paragraph.children
                continue

            if paragraph.lang != lang:
                yield lang, atoms
                lang = paragraph.lang
                atoms = paragraph.children
            else:
                atoms += paragraph.children

        if lang is not None:
            yield lang, atoms

    def is_empty(self) -> bool:
        """Check whether the document contains at least one atom

        Note: The document might still have visible content. If you want to check for that, check
        that `document.text()` is not empty.

        Returns:
            bool: True if the document does not contain at least one atom
        """
        for paragraph in self.children:
            for atom in paragraph.children:
                return False
        return True

    def text(self) -> str:
        return "".join(p.text() for p in self.children)

    def start(self) -> Optional[float]:
        if len(self.children) > 0:
            return self.children[0].start()

    def end(self) -> Optional[float]:
        if len(self.children) > 0:
            return self.children[-1].end()

    def iter_atoms(self) -> Iterator[Atom]:
        return itertools.chain.from_iterable(p.children for p in self.children)
