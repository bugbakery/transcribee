import asyncio
import logging
from typing import Any, AsyncIterator, Callable, Optional, Tuple

import requests
from numpy.typing import NDArray
from transcribee_proto.document import UNKNOWN_SPEAKER, Atom, Paragraph
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


# TODO(robin): this currently filters all special tokens
# recovery of multilingual text could be hard if we keep this filtering
def _transcription_work(
    result_queue: asyncio.Queue,
    data: NDArray[Any],
    model_name: str,
    lang_code,
    loop: asyncio.BaseEventLoop,
    progress_callback: Optional[Callable],
):
    def handle_new_segment(
        ctx: api.Context,
        n_new: int,
        result_queue_and_loop: Tuple[asyncio.Queue, asyncio.BaseEventLoop],
    ):
        result_queue, loop = result_queue_and_loop
        segment = ctx.full_n_segments() - n_new

        rest_token_bytes = b""
        rest_conf = 0
        rest_count = 0
        rest_start = 0

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
                start = token.t0
                end = token.t1

                # tokens can be incomplete utf-8, so we sometimes need to combine tokens to
                # get valid utf we assume this invalid utf cannot span multiple segments
                try:
                    text = (rest_token_bytes + token_bytes).decode("utf-8")
                    conf = (rest_conf + conf) / (rest_count + 1)
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
                    if rest_start != 0:
                        rest_start = start
                    continue

                rest_token_bytes = b""
                rest_conf = 0
                rest_count = 0
                rest_start = 0

                atoms.append(
                    Atom(
                        text=text,
                        conf=conf,
                        # 10·ms -> ms
                        start=start * 10,
                        # 10·ms -> ms
                        end=end * 10,
                    )
                )

            paragraph = Paragraph(
                children=atoms,
                speaker=UNKNOWN_SPEAKER,
            )

            # asyncio.Queue is not threadsafe, so we need to use the *_threadsafe functions
            loop.call_soon_threadsafe(result_queue.put_nowait, paragraph)
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
        .with_language(lang_code)
        .with_max_segment_length(60)  # parameter stolen from whisper.cpp cli
        .with_token_timestamps(True)
    )
    params.on_new_segment(handle_new_segment, (result_queue, loop))
    if progress_callback is not None:
        params.on_progress(progress_callback, None)
    ctx.full(params, data)

    return TranscriptionWorkDoneToken()


async def transcribe(
    data: NDArray, model_name: str, lang_code="en", progress_callback=None
) -> AsyncIterator[Paragraph]:
    loop = asyncio.get_running_loop()
    results_queue = asyncio.Queue()

    transcription_work = loop.run_in_executor(
        None,
        _transcription_work,
        results_queue,
        data,
        model_name,
        lang_code,
        loop,
        progress_callback,
    )

    pending = {asyncio.create_task(results_queue.get()), transcription_work}

    run = True
    while run:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for fut in done:
            value = fut.result()
            if isinstance(value, TranscriptionWorkDoneToken):
                run = False
            else:

                yield value

                for _ in range(results_queue.qsize()):
                    yield results_queue.get_nowait()

        # If we are still running, `transcription_work` cannot have returend, i.e. we got an
        # element from the results queue. -> We need to add a new `results_queue.get`-Task
        if run:
            pending.add(asyncio.create_task(results_queue.get()))

    for task in pending:
        task.cancel()
