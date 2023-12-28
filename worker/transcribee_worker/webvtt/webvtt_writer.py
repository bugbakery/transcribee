#!/usr/bin/env python3

import dataclasses
import enum
import re
from abc import ABC, abstractmethod


class SubtitleFormat(str, enum.Enum):
    VTT = "vtt"
    SRT = "srt"


class VttElement(ABC):
    @abstractmethod
    def to_string(self, format: SubtitleFormat) -> str:
        ...


class Vertical(str, enum.Enum):
    RL = "rl"
    LR = "lr"


class Align(str, enum.Enum):
    START = "start"
    CENTER = "center"
    END = "end"


@dataclasses.dataclass
class VttCueSettings(VttElement):
    vertical: None | Vertical
    line: None | int | str
    position: None | str
    size: None | str
    align: None | Align

    def to_string(self, format: SubtitleFormat):
        if format == SubtitleFormat.SRT:
            return ""

        def format_elem(name, elem):
            if elem is None:
                return []
            else:
                return [f"{name}:{elem}"]

        return " ".join(
            format_elem("vertical", self.vertical)
            + format_elem("line", self.line)
            + format_elem("position", self.position)
            + format_elem("size", self.size)
            + format_elem("align", self.align)
        )


def formatted_time(secs: float):
    subseconds = int((secs % 1.0) * 1000)
    seconds = int(secs % 60)
    minutes = int((secs / 60) % 60)
    hours = int((secs / 60 / 60) % 60)

    return f"{hours:02}:{minutes:02}:{seconds:02}.{subseconds:03}"


class VttCue(VttElement):
    identifier: str | None
    start_time: float
    end_time: float
    settings: VttCueSettings | None
    payload: str

    def __init__(
        self,
        start_time: float,
        end_time: float,
        payload: str,
        payload_escaped: bool | None = None,
        identifier: str | None = None,
        identifier_escaped: bool | None = None,
        settings: VttCueSettings | None = None,
    ):
        if start_time >= end_time:
            raise ValueError("Cue end time must be greater than cue start time")

        self.start_time = start_time
        self.end_time = end_time

        if not payload_escaped:
            payload = escape_vtt_string(payload)

        self.payload = payload

        if identifier and not identifier_escaped:
            identifier = escape_vtt_string(identifier)

        if identifier and "\n" in identifier:
            raise ValueError("WebVTT cue identifiers MUST NOT contain a newline")

        if identifier and "-->" in identifier:
            raise ValueError("WebVTT cue identifiers MUST NOT contain -->")

        self.identifier = identifier
        self.settings = settings

    def to_string(self, format: SubtitleFormat):
        ident = f"{self.identifier}\n" if self.identifier else ""
        time = f"{formatted_time(self.start_time)} --> {formatted_time(self.end_time)}"
        settings = f"{self.settings.to_string(format)}".strip() if self.settings else ""

        return ident + time + settings + "\n" + self.payload


class VttComment(VttElement):
    comment_text: str

    def __init__(self, text: str, escaped: bool = False):
        if not escaped:
            text = escape_vtt_string(text)
        if "-->" in text:
            raise ValueError("WebVTT comments MUST NOT contain -->")

        self.comment_text = text

    def to_string(self, format: SubtitleFormat):
        if format != SubtitleFormat.VTT:
            return ""
        return f"NOTE {self.comment_text}"


def escape_vtt_string(text: str) -> str:
    escape_map = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}
    re.sub(r"[&<>]", lambda obj: escape_map[obj.group(0)], text)
    return text


class VttHeader(VttElement):
    header_text: str

    def __init__(self, text: str, escaped: bool = False):
        if not escaped:
            text = escape_vtt_string(text)

            if "-->" in text:
                raise ValueError("WebVTT text header MUST NOT contain -->")

            if "\n" in text:
                raise ValueError("WebVTT text header MUST NOT contain newlines")

            self.header_text = text

    def to_string(self, format: SubtitleFormat):
        if format != SubtitleFormat.VTT:
            return ""

        return f"WEBVTT {self.header_text}"


class WebVtt:
    elements: list[VttElement]

    def __init__(self, header=""):
        self.elements = [VttHeader(header)]

    def add(self, element: VttElement):
        self.elements.append(element)

    def to_string(self, format: SubtitleFormat = SubtitleFormat.VTT):
        as_strings = [elem.to_string(format) for elem in self.elements]
        return "\n\n".join([elem for elem in as_strings if len(elem) > 0]) + "\n"
