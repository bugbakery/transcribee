import functools
import logging

import requests
from numpy.typing import ArrayLike
from transcribee_proto.document import TranscriptSegment
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


@functools.lru_cache()
def get_context(model_name: str) -> api.Context:
    model_file = get_model_file(model_name)
    logging.info(f"loading model {model_name}...")
    ctx = api.Context.from_file(str(model_file))
    ctx.reset_timings()
    return ctx


def transcribe(data: ArrayLike, model_name: str, lang_code="en", num_proc=4):
    ctx = get_context(model_name)
    params = api.Params.from_sampling_strategy(
        api.SamplingStrategies.from_strategy_type(api.SAMPLING_GREEDY)
    )
    params.language = lang_code
    params.token_timestamps = True
    ctx.full_parallel(params, data, num_proc)
    tokens = (
        ctx.full_get_token_data(i, j)
        for i in range(ctx.full_n_segments())
        for j in range(ctx.full_n_tokens(i))
    )
    return [
        TranscriptSegment(
            text=ctx.token_to_str(token.id), conf=token.p, start=token.t0, end=token.t1
        )
        for token in tokens
    ]
