import asyncio
import logging
from typing import Iterator, Tuple

import requests
from numpy.typing import ArrayLike
from transcribee_proto.document import UNKNOWN_SPEAKER, Paragraph, TranscriptSegment
from transcribee_worker.config import MODELS_DIR
from whispercpp import api


def get_model_file(model_name: str):
    whisper_models_dir = MODELS_DIR / "whisper"
    whisper_models_dir.mkdir(parents=True, exist_ok=True)
    model_file = whisper_models_dir / f"{model_name}.bin"

    if not model_file.exists():
        logging.info(f"downloading model {model_name} because it does not exist yet...")
        base_url = "https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main"
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


class TranscriptionWorkDoneToken:
    pass


def _transcription_work(
    result_queue: asyncio.Queue,
    data: ArrayLike,
    model_name: str,
    lang_code,
    loop: asyncio.BaseEventLoop,
):
    def handle_new_segment(
        ctx: api.Context,
        n_new: int,
        result_queue_and_loop: Tuple[asyncio.Queue, asyncio.BaseEventLoop],
    ):
        result_queue, loop = result_queue_and_loop
        segment = ctx.full_n_segments() - n_new
        while segment < ctx.full_n_segments():
            tokens = (
                ctx.full_get_token_data(segment, token_idx)
                for token_idx in range(ctx.full_n_tokens(segment))
            )
            paragraph = Paragraph(
                children=[
                    TranscriptSegment(
                        text=ctx.token_to_str(token.id),
                        conf=token.p,
                        start=token.t0,
                        end=token.t1,
                    )
                    for token in tokens
                ],
                speaker=UNKNOWN_SPEAKER,
            )
            # asyncio.Queue is not threadsafe, so we need to use the *_threadsafe functions
            loop.call_soon_threadsafe(result_queue.put_nowait, paragraph)
            segment += 1

    ctx = get_context(model_name)
    params = api.Params.from_sampling_strategy(
        api.SamplingStrategies.from_strategy_type(api.SAMPLING_GREEDY)
    )
    params.language = lang_code
    params.token_timestamps = True
    params.on_new_segment(handle_new_segment, (result_queue, loop))
    ctx.full(params, data)

    return TranscriptionWorkDoneToken()


async def transcribe(
    data: ArrayLike, model_name: str, lang_code="en", _num_proc=4
) -> Iterator[Paragraph]:
    loop = asyncio.get_running_loop()
    results_queue = asyncio.Queue()

    transcription_work = loop.run_in_executor(
        None, _transcription_work, results_queue, data, model_name, lang_code, loop
    )

    pending = set([asyncio.create_task(results_queue.get()), transcription_work])

    run = True
    while run:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for fut in done:
            value = fut.result()
            if isinstance(value, TranscriptionWorkDoneToken):
                run = False
            else:
                if run:
                    pending.add(asyncio.create_task(results_queue.get()))
                yield value

                for _ in range(results_queue.qsize()):
                    yield results_queue.get_nowait()

    for task in pending:
        task.cancel()
