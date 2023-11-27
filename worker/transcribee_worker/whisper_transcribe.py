import logging
import re
from typing import TYPE_CHECKING, Any, AsyncIterator, List, Optional

import requests
from numpy.typing import NDArray
from transcribee_proto.document import Atom, Paragraph
from transcribee_worker.config import settings
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import SubmissionQueue, async_task
from whispercppy import api

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


def get_model_file(model_name: str):
    whisper_models_dir = settings.MODELS_DIR / "whisper"
    whisper_models_dir.mkdir(parents=True, exist_ok=True)
    model_file = whisper_models_dir / f"{model_name}.bin"

    if not model_file.exists():
        logging.info(f"downloading model {model_name} because it does not exist yet...")
        base_url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
        url = f"{base_url}/ggml-{model_name}.bin"
        r = requests.get(url, allow_redirects=True)
        r.raise_for_status()
        with model_file.open(mode="wb") as f:
            f.write(r.content)

    return model_file


def get_context(model_name: str) -> api.Context:
    model_file = get_model_file(model_name)
    logging.info(f"loading model {model_name}...")
    ctx = api.Context.from_file(str(model_file))
    ctx.reset_timings()
    return ctx


# TODO(robin): this currently filters all special tokens
# recovery of multilingual text could be hard if we keep this filtering
def _transcription_work(
    queue: SubmissionQueue,
    data: NDArray[Any],
    start_offset: float,
    model_name: str,
    lang_code: Optional[str],
    progress_callback: Optional[ProgressCallbackType],
):
    def handle_new_segment(
        ctx: api.Context,
        n_new: int,
        queue: SubmissionQueue,
    ):
        segment = ctx.full_n_segments() - n_new

        rest_token_bytes = b""
        rest_conf = 0
        rest_count = 0
        rest_start = 0
        rest_conf_ts = 0

        lang: str
        if lang_code is None or lang_code in ["", "auto"]:
            lang = ctx.lang_id_to_str(ctx.full_lang_id())
        else:
            lang = lang_code

        while segment < ctx.full_n_segments():
            tokens = (
                ctx.full_get_token_data(segment, token_idx)
                for token_idx in range(ctx.full_n_tokens(segment))
            )

            atoms = []
            for token in tokens:
                if token.id in special_tokens or token.id > special_tokens[-1]:
                    continue

                token_bytes = ctx.token_to_bytes(token.id)
                conf = token.p
                conf_ts = token.pt
                start = token.t0
                end = token.t1

                # tokens can be incomplete utf-8, so we sometimes need to combine tokens to
                # get valid utf we assume this invalid utf cannot span multiple segments
                try:
                    text = (rest_token_bytes + token_bytes).decode("utf-8")
                    conf = (rest_conf + conf) / (rest_count + 1)
                    conf_ts = (rest_conf_ts + conf_ts) / (rest_count + 1)
                    if rest_start != 0:
                        start = rest_start
                except UnicodeDecodeError:
                    logging.info(
                        "invalid utf-8 encountered in whisper token, skipping decoding, "
                        "appending to rest"
                    )
                    rest_token_bytes += token_bytes
                    rest_conf += conf
                    rest_count += 1
                    rest_conf_ts += conf_ts
                    if rest_start != 0:
                        rest_start = start
                    continue

                rest_token_bytes = b""
                rest_conf = 0
                rest_conf_ts = 0
                rest_count = 0
                rest_start = 0

                atoms.append(
                    Atom(
                        text=text,
                        conf=conf,
                        # 10·ms -> seconds
                        start=(start / 100) + start_offset,
                        # 10·ms -> seconads
                        end=(end / 100) + start_offset,
                        conf_ts=conf_ts,
                    )
                )

            paragraph = Paragraph(
                children=atoms,
                lang=lang,
            )

            queue.submit(paragraph)
            segment += 1

    ctx = get_context(model_name)

    special_tokens = [
        ctx.eot_token,  # type: ignore
        ctx.sot_token,  # type: ignore
        ctx.prev_token,  # type: ignore
        ctx.solm_token,  # type: ignore
        ctx.not_token,  # type: ignore
        ctx.beg_token,  # type: ignore
    ]

    sampling = api.SamplingStrategies.from_enum(api.SAMPLING_GREEDY)
    sampling.greedy.best_of = 5  # parameter stolen from whisper.cpp cli
    params = (
        api.Params.from_sampling_strategy(sampling)
        .with_no_context(
            False
        )  # if False, feeds back already transcribed text back to the model
        .with_num_threads(4)
        .with_max_segment_length(0)  # Unlimited segment length
        .with_token_timestamps(True)
    )
    if lang_code is not None:
        params = params.with_language(lang_code)
    params.on_new_segment(handle_new_segment, queue)
    if progress_callback is not None:
        params.on_progress(
            lambda _ctx, progress, _data: progress_callback(progress=progress / 100),
            None,
        )
    ctx.full(params, data)


def transcribe(
    data: NDArray,
    start_offset: float,
    model_name: str,
    lang_code="en",
    progress_callback=None,
) -> AsyncIterator[Paragraph]:
    return async_task(
        _transcription_work,
        data,
        start_offset,
        model_name,
        lang_code,
        progress_callback,
    )


async def recombine_split_words(
    iter: AsyncIterator[Paragraph],
) -> AsyncIterator[Paragraph]:
    last_paragraph = None
    async for paragraph in iter:
        if last_paragraph is None:
            last_paragraph = paragraph
            continue

        starts_with_whitespace = paragraph.text()[:1].isspace()
        if starts_with_whitespace:
            yield last_paragraph
            last_paragraph = paragraph
        else:
            last_paragraph.children.extend(paragraph.children)

    if last_paragraph is not None:
        yield last_paragraph


def _para_move_space_to_prev_token(paragraph: Paragraph):
    for prev_i, atom in enumerate(paragraph.children[1:]):
        starts_with_whitespace = atom.text[:1].isspace()
        if starts_with_whitespace:
            paragraph.children[prev_i].text += atom.text[:1]
            atom.text = atom.text[1:]
    return paragraph


async def move_space_to_prev_token(
    iter: AsyncIterator[Paragraph],
) -> AsyncIterator[Paragraph]:
    last_paragraph = await anext(iter)
    last_paragraph.children[0].text = last_paragraph.children[0].text.lstrip()
    _para_move_space_to_prev_token(last_paragraph)

    async for paragraph in iter:
        para_starts_with_whitespace = paragraph.children[0].text[:1].isspace()
        if para_starts_with_whitespace:
            last_paragraph.children[-1].text += paragraph.children[0].text[:1]
            paragraph.children[0].text = paragraph.children[0].text[1:]

        yield last_paragraph
        paragraph = _para_move_space_to_prev_token(paragraph)
        last_paragraph = paragraph

    if last_paragraph is not None:
        yield last_paragraph


async def strict_sentence_paragraphs(
    iter: AsyncIterator[Paragraph],
) -> AsyncIterator[Paragraph]:
    acc_paragraph = None
    acc_used_paras = []
    combination_active = True
    async for paragraph in iter:
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


async def combine_tokens_to_words(
    iter: AsyncIterator[Paragraph],
) -> AsyncIterator[Paragraph]:
    async for paragraph in iter:
        locale = Locale(paragraph.lang)
        word_iter = BreakIterator.createWordInstance(locale)
        word_iter.setText(paragraph.text())
        breaks: List[int] = list(word_iter)
        assert breaks[-1] == len(paragraph.text())

        new_para = Paragraph(
            children=[], speaker=paragraph.speaker, lang=paragraph.lang
        )
        pos = 0
        current_atom = None
        for atom in paragraph.children:
            pos_after_atom = pos + len(atom.text)
            if current_atom is None:
                current_atom = Atom(
                    text=atom.text,
                    conf=atom.conf,
                    start=atom.start,
                    end=atom.end,
                    conf_ts=atom.conf_ts,
                )
                pos = pos_after_atom
            else:
                current_atom.text += atom.text
                current_atom.end = atom.end
                current_atom.conf = min(current_atom.conf, atom.conf)
                current_atom.conf_ts = min(current_atom.conf_ts, atom.conf_ts)
                pos = pos_after_atom

            if pos_after_atom in breaks:
                new_para.children.append(current_atom)
                current_atom = None

        if current_atom is not None:
            new_para.children.append(current_atom)
        yield new_para


async def transcribe_clean(
    data: NDArray,
    start_offset: float,
    model_name: str,
    lang_code: str = "en",
    progress_callback=None,
):
    chain = (
        recombine_split_words,
        move_space_to_prev_token,
        strict_sentence_paragraphs,
        combine_tokens_to_words,
    )
    iter = aiter(
        transcribe(
            data=data,
            start_offset=start_offset,
            model_name=model_name,
            lang_code=lang_code,
            progress_callback=progress_callback,
        )
    )
    for elem in chain:
        iter = elem(iter)
    async for v in iter:
        yield v
