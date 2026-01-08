import enum
import re
import sys
from math import ceil
from pathlib import Path
from typing import Mapping

from pydantic import BaseModel
from transcribee_proto.document import (
    Atom,
    Document,
    Paragraph,
)
from transcribee_proto.document import (
    Document as EditorDocument,
)

from .webvtt_writer import VttCue, WebVtt, escape_vtt_string


def get_speaker_name(
    speaker: str | None,
    speaker_names: Mapping[str, str],
) -> str:
    if speaker is None:
        return "Unknown Speaker"
    else:
        try:
            return speaker_names[speaker]
        except KeyError:
            return f"Unnamed Speaker {speaker}"


class VoicePlacement(str, enum.Enum):
    NONE = "NONE"
    ALL = "ALL"
    ON_CHANGE = "ON_CHANGE"


class VoiceFormat(str, enum.Enum):
    TAG = "TAG"
    FIRST = "FIRST"
    FULL = "FULL"


class VoiceOptions(BaseModel):
    format: VoiceFormat
    placement: VoicePlacement


class ExportSettings(BaseModel):
    voice: VoiceOptions
    include_word_timings: bool

    max_line_length: int
    maximum_rows: int
    min_line_length: int

    pack_paragraphs: bool


def format_speaker(name, format: VoiceFormat):
    match format:
        case VoiceFormat.TAG:
            return f"<v {name}>"
        case VoiceFormat.FIRST:
            return name.split()[0] + ": "
        case VoiceFormat.FULL:
            return name + ": "


# this splits a list of atoms into multiple parts
# num_splits gives the number of splits of perform -> num_splits = 1 means one split
# is performed and two parts are returned
# this finds the way to split the list of atoms into parts that are as similar in length as possible
# (without breaking up the atoms itself)
def reflow_text(atoms, num_splits):
    def atoms_text_length(atoms):
        return len("".join(a.text for a in atoms))

    atom_length = atoms_text_length(atoms)

    target_length = int(ceil(atom_length / (num_splits + 1)))

    def split(atoms, num_splits):
        if num_splits == 0:
            yield [atoms]
            return

        partial_split = []

        for i, atom in enumerate(atoms):
            old_split = partial_split.copy()

            partial_split.append(atom)

            if atoms_text_length(partial_split) >= target_length:
                for sub_split in split(atoms[i:], num_splits - 1):
                    yield [old_split] + sub_split

                for sub_split in split(atoms[i + 1 :], num_splits - 1):
                    yield [partial_split] + sub_split

                break

    splits = list(split(atoms, num_splits))
    text_splits = []
    for canidate in splits:
        lines = []
        for line in canidate:
            lines.append("".join(a.text for a in line).strip())

        text_splits.append(lines)

    def score_canidate(canidate):
        mean_length = sum(len(line) for line in canidate) / len(canidate)
        error = 0
        for line in canidate:
            error += (len(line) - mean_length) ** 2

        return error

    scores = [score_canidate(c) for c in text_splits]

    best = scores.index(min(scores))

    return splits[best], text_splits[best]


# splits multi word atoms into atoms of subwords
# this does not try to do anything with the timestamps
# so do not expect the split up atoms to have any useable timestamps
def split_atoms(atoms):
    result = []
    for atom in atoms:
        parts = re.split("( )", atom.text)
        for part in parts:
            result.append(
                Atom(
                    text=part,
                    start=atom.start,
                    end=atom.end,
                    conf=atom.conf,
                    conf_ts=atom.conf_ts,
                )
            )

    return result


def emit_cue(vtt, speaker_prefix, pars, config):
    atoms = sum((split_atoms(par.children) for par in pars), start=[])
    if len(atoms) == 0:
        return

    start = min(atom.start for atom in atoms)
    end = max(atom.end for atom in atoms)
    if end <= start:
        end = start + 0.02
    atoms = [
        Atom(
            text=speaker_prefix,
            start=start,
            end=start,
            conf=1.0,
            conf_ts=0.0,
        )
    ] + atoms

    payload_length = len("".join(a.text for a in atoms))
    if payload_length < (config.max_line_length + config.min_line_length):
        target_splits = 1
    else:
        target_splits = config.maximum_rows

    _, lines = reflow_text(atoms, target_splits - 1)

    payload = "\n".join(lines)

    vtt.add(
        VttCue(
            start_time=start,
            end_time=end,
            payload=payload,
            payload_escaped=True,
        )
    )


# TODO: connect export settings to API
def generate_web_vtt(
    doc: Document,
    include_speaker_names: bool,
    include_word_timing: bool,
    max_line_length: int | None,
) -> WebVtt:
    config = ExportSettings(
        voice=VoiceOptions(
            format=VoiceFormat.FIRST,
            placement=VoicePlacement.ON_CHANGE,
        ),
        pack_paragraphs=True,
        min_line_length=10,
        max_line_length=42,
        maximum_rows=2,
        include_word_timings=False,
    )

    vtt = WebVtt(
        "This file was generated using transcribee."
        " Find out more at https://github.com/bugbakery/transcribee"
    )

    assert doc.speaker_names is not None

    speakers = [
        format_speaker(
            escape_vtt_string(get_speaker_name(p.speaker, doc.speaker_names)),
            config.voice.format,
        )
        for p in doc.children
    ]
    speaker_changes = [True] + [a != b for a, b in zip(speakers[1:], speakers[:-1])]

    character_limit_pack = config.maximum_rows * config.max_line_length
    character_limit_single = character_limit_pack + config.min_line_length

    last_speaker = None
    pars = []

    def par_len(pars):
        return sum(len(p.text()) for p in pars)

    for speaker, speaker_change, par in zip(speakers, speaker_changes, doc.children):
        match config.voice.placement:
            case VoicePlacement.NONE:
                speaker = ""
            case VoicePlacement.ON_CHANGE:
                if not speaker_change:
                    speaker = ""
            case VoicePlacement.ALL:
                pass

        if len(par.children) == 0:
            continue

        this_par_len = len(par.text())
        can_pack = config.pack_paragraphs and not speaker_change

        # can pack and previous wanted to pack with us
        if can_pack and len(pars) != 0:
            fits = par_len(pars) + this_par_len < character_limit_pack
            if fits:
                pars.append(par)
                continue

        # here we are done packing with the previous one, flush any remaining...
        if len(pars) != 0:
            emit_cue(vtt, last_speaker, pars, config)
            pars = []

        # investigate the current paragraph. try packing with the next if we are below the limit
        if this_par_len < character_limit_pack:
            pars.append(par)
        # if we are only slightly above the cue limit, emit this as a single paragraph
        elif this_par_len < character_limit_single:
            emit_cue(vtt, speaker, [par], config)
        else:
            # we are so far over the limit that we need to split this into multiple paragraphs
            # we do this by reflowing it into the appropriate amount of paragraphs
            num_splits = int(ceil(len(par.text()) / character_limit_pack))
            split_pars, _ = reflow_text(par.children, num_splits - 1)
            for split_par in split_pars:
                emit_cue(
                    vtt, speaker, [Paragraph(children=split_par, lang=par.lang)], config
                )
                speaker = ""

        last_speaker = speaker

    return vtt


if __name__ == "__main__":
    import automerge

    doc = automerge.load(Path(sys.argv[1]).read_bytes())

    res = generate_web_vtt(
        EditorDocument.model_validate(automerge.dump(doc)), True, False, 42
    ).to_string()
    print(res)
