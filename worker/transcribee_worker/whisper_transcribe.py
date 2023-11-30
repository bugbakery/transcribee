import re
from typing import TYPE_CHECKING, Iterator, Optional

import faster_whisper
import faster_whisper.transcribe
from faster_whisper import WhisperModel
from numpy.typing import NDArray
from transcribee_proto.document import Atom, Paragraph
from transcribee_worker.config import settings
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import SubmissionQueue, async_task

if TYPE_CHECKING:
    from .icu import BreakIterator, Locale
else:
    from icu import BreakIterator, Locale

# Regexes that prevent the sentence splitting logic from breaking here
DONT_SPLIT_HERE_RES = [
    re.compile(r"\s\S\.\S\.\s?$"),  # Prevent splitting on "e.g.", "i.e.", "z.B."
    re.compile(
        r".*\d\.\s?$"
    ),  # Don't split on numerals followed by a dot, e.g. "during the 20. century"
]
# Regexes that protect a paragraph from being recombined
DONT_COMBINE_RES = [
    re.compile(r"^\[[^\s]*\]$"),  # [MUSIC]
    re.compile(r"^\*[^\s]*\*$"),  # *Applause*
]


def move_space_to_prev_token(
    iter: Iterator[Paragraph],
) -> Iterator[Paragraph]:
    last_paragraph = next(iter)
    last_paragraph.children[0].text = last_paragraph.children[0].text.lstrip()
    _para_move_space_to_prev_token(last_paragraph)

    for paragraph in iter:
        para_starts_with_whitespace = paragraph.children[0].text[:1].isspace()
        if para_starts_with_whitespace:
            last_paragraph.children[-1].text += paragraph.children[0].text[:1]
            paragraph.children[0].text = paragraph.children[0].text[1:]

        yield last_paragraph
        paragraph = _para_move_space_to_prev_token(paragraph)
        last_paragraph = paragraph

    if last_paragraph is not None:
        yield last_paragraph


def _para_move_space_to_prev_token(paragraph: Paragraph):
    for prev_i, atom in enumerate(paragraph.children[1:]):
        starts_with_whitespace = atom.text[:1].isspace()
        if starts_with_whitespace:
            paragraph.children[prev_i].text += atom.text[:1]
            atom.text = atom.text[1:]
    return paragraph


def whisper_segment_to_transcribee_segment(
    iter: Iterator[faster_whisper.transcribe.Segment], lang: str, start_offset: float
) -> Iterator[Paragraph]:
    for seg in iter:
        assert seg.words is not None
        yield Paragraph(
            children=[
                Atom(
                    text=word.word,
                    start=word.start + start_offset,
                    end=word.end + start_offset,
                    conf=word.probability,
                    conf_ts=1,
                )
                for word in seg.words
            ],
            lang=lang,
        )


def strict_sentence_paragraphs(
    iter: Iterator[Paragraph],
) -> Iterator[Paragraph]:
    acc_paragraph = None
    acc_used_paras = []
    combination_active = True
    for paragraph in iter:
        if not combination_active:
            yield paragraph
            continue
        elif acc_paragraph is None:
            acc_paragraph = Paragraph(
                lang=paragraph.lang, speaker=paragraph.speaker, children=[]
            )
            acc_used_paras = []
        elif (
            (start := acc_paragraph.start()) is not None
            and (end := paragraph.end()) is not None
            and end - start > 30
        ):
            # It seems like whisper doesn't produce sentence breaks. Ignore the
            # current `acc_paragraph` and yield the original paras instead,
            # disable this step until the end of the document
            combination_active = False
            for para in acc_used_paras:
                yield para
            yield paragraph
            continue
        elif (
            acc_paragraph.lang != paragraph.lang
            or acc_paragraph.speaker != paragraph.speaker
        ):
            if acc_paragraph.children:
                yield acc_paragraph
            acc_paragraph = Paragraph(
                lang=paragraph.lang, speaker=paragraph.speaker, children=[]
            )
            acc_used_paras = []

        if any(regex.search(paragraph.text()) for regex in DONT_COMBINE_RES):
            if acc_paragraph.children:
                yield acc_paragraph
            acc_paragraph = None
            yield paragraph
            continue

        locale = Locale(paragraph.lang)
        sentence_iter = BreakIterator.createSentenceInstance(locale)
        sentence_iter.setText(acc_paragraph.text() + paragraph.text())
        breaks = list(sentence_iter)[:-1]  # The last break is the end of the text
        offset = 0
        if offset + len(acc_paragraph.text()) in breaks:
            yield acc_paragraph
            offset += len(acc_paragraph.text())
            acc_paragraph = Paragraph(
                lang=paragraph.lang, speaker=paragraph.speaker, children=[]
            )
            acc_used_paras = []
        acc_yield_offset = 0
        for i, atom in enumerate(paragraph.children):
            acc_paragraph.children.append(atom)
            text = acc_paragraph.text()
            if offset + len(text) in breaks and not any(
                regex.search(text) for regex in DONT_SPLIT_HERE_RES
            ):
                yield acc_paragraph
                offset += len(acc_paragraph.text())
                acc_paragraph = Paragraph(
                    lang=paragraph.lang, speaker=paragraph.speaker, children=[]
                )
                acc_yield_offset = i
        acc_used_paras.append(
            Paragraph(
                lang=paragraph.lang,
                speaker=paragraph.speaker,
                children=paragraph.children[acc_yield_offset:],
            )
        )
    if acc_paragraph is not None and acc_paragraph.children and combination_active:
        yield acc_paragraph


def transcribe_clean(
    queue: SubmissionQueue,
    data: NDArray,
    sr: int,
    start_offset: float,
    model_name: str,
    progress_callback: ProgressCallbackType,
    lang_code: Optional[str] = "en",
):
    chain = (
        move_space_to_prev_token,
        strict_sentence_paragraphs,
    )
    model = WhisperModel(
        model_size_or_path=model_name,
        download_root=str((settings.MODELS_DIR / "faster_whisper").absolute()),
    )
    seg_iter, info = model.transcribe(
        audio=data, word_timestamps=True, language=lang_code
    )
    seg_iter = whisper_segment_to_transcribee_segment(
        iter(seg_iter), lang=info.language, start_offset=start_offset
    )
    total_len = len(data) / sr
    for elem in chain:
        seg_iter = elem(seg_iter)
    for v in seg_iter:
        queue.submit(v)
        if progress_callback is not None and v.children:
            progress = (v.children[-1].end - start_offset) / total_len
            progress_callback(
                progress=progress,
                step="transcribe",
            )


def transcribe_clean_async(
    data: NDArray,
    sr: int,
    start_offset: float,
    model_name: str,
    progress_callback: ProgressCallbackType,
    lang_code: Optional[str] = "en",
):
    return aiter(
        async_task(
            transcribe_clean,
            data=data,
            sr=sr,
            start_offset=start_offset,
            model_name=model_name,
            lang_code=lang_code,
            progress_callback=progress_callback,
        )
    )
