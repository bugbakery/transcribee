import logging

from transcribee_proto.document import Atom, Document, Paragraph

from .webvtt_writer import VttCue, WebVtt, escape_vtt_string, formatted_time


def get_speaker_name(
    speaker: str | None,
    speaker_names: dict[str, str],
) -> str:
    if speaker is None:
        return "Unknown Speaker"
    else:
        try:
            return speaker_names[speaker]
        except KeyError:
            return f"Unnamed Speaker {speaker}"


def atom_to_string(item: Atom, include_word_timings: bool):
    if include_word_timings and isinstance(item.start, float):
        return (
            f"<{formatted_time(item.start)}><c>{escape_vtt_string(str(item.text))}</c>"
        )
    else:
        return escape_vtt_string(str(item.text))


def can_generate_vtt(paras: list[Paragraph] | None):
    if paras is None:
        return (False, "No document content")

    for para in paras:
        for atom in para.children:
            if not isinstance(atom.end, float) or not isinstance(atom.start, float):
                return (False, "Missing timings for at least one atom")

        return (True, "")


def paragraph_to_cues(
    paragraph: Paragraph,
    include_word_timings: bool,
    include_speaker_names: bool,
    max_line_length: int | None,
    speaker_names,
):
    cues = []
    cue_payload = ""
    cue_length = 0
    cue_start = None
    cue_end = None

    def push_payload(payload):
        nonlocal cue_start, cue_end
        if include_speaker_names and paragraph.speaker:
            payload = (
                f"<v {escape_vtt_string(get_speaker_name(paragraph.speaker, speaker_names))}>"
                + payload
            )

        assert cue_start is not None
        assert cue_end is not None

        if cue_start >= cue_end:
            logging.debug(
                f"found {cue_start=} that is not before {cue_end=}"
                ", fixing the end to be behind cue_start"
            )
            cue_end = cue_start + 0.02

        cues.append(
            VttCue(
                start_time=cue_start,
                end_time=cue_end,
                payload=payload,
                payload_escaped=True,
            )
        )

    for atom in paragraph.children:
        atom_text = str(atom.text)
        if (
            max_line_length is not None
            and cue_start is not None
            and cue_end is not None
            and cue_length + len(atom_text) > max_line_length
        ):
            push_payload(cue_payload)

            cue_payload = ""
            cue_length = 0
            cue_start = None
            cue_end = None

        if atom.start and (cue_start is None or atom.start < cue_start):
            cue_start = atom.start

        if atom.end and (cue_end is None or atom.end > cue_end):
            cue_end = atom.end

        cue_payload += atom_to_string(atom, include_word_timings)
        cue_length += len(atom_text)

    if len(cue_payload) > 0:
        if cue_start is None or cue_end is None:
            raise ValueError(
                "Paragraph contains no timings, cannot generate cue(s)."
                " Make sure to only call this function if `canGenerateVtt` returns true",
            )
        push_payload(cue_payload)

    return cues


def generate_web_vtt(
    doc: Document,
    include_speaker_names: bool,
    include_word_timing: bool,
    max_line_length: int | None,
) -> WebVtt:
    vtt = WebVtt(
        "This file was generated using transcribee."
        " Find out more at https://github.com/bugbakery/transcribee"
    )
    for par in doc.children:
        if len(par.children) == 0:
            continue

        for cue in paragraph_to_cues(
            par,
            include_word_timing,
            include_speaker_names,
            max_line_length,
            doc.speaker_names,
        ):
            vtt.add(cue)

    return vtt
