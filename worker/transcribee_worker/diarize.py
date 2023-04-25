import logging
from typing import List, Optional, SupportsFloat, SupportsInt

import torch
from pyannote.audio import Pipeline
from transcribee_proto.document import Segment

from .config import settings


def ensure_float(x: Optional[SupportsFloat]) -> Optional[float]:
    if x is None:
        return None
    else:
        return float(x)


def ensure_int(x: Optional[SupportsInt]) -> Optional[int]:
    if x is None:
        return None
    else:
        return int(x)


def diarize(audio, progress_callback) -> List[Segment]:
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization@2.1",
        use_auth_token=settings.HUGGINGFACE_TOKEN,
        cache_dir=settings.MODELS_DIR,
    )
    device_name = "cpu"
    if torch.backends.mps.is_available():
        device_name = "mps"
        pipeline.to("mps")

    def _hook(phase, *args, **kwargs):
        total = kwargs.pop("total", None)
        completed = kwargs.pop("completed", None)
        phases = {
            "segmentation": {"scale": 0.2, "offset": 0},
            "embeddings": {"scale": 0.8, "offset": 0.2},
        }
        progress = None
        if total is not None and completed is not None and phase in phases:
            progress = (
                phases[phase]["offset"] + (completed / total) * phases[phase]["scale"]
            )
        progress_callback(
            progress=ensure_float(
                progress
            ),  # Sometimes a numpy value -> convert to native python type
            extra_data={
                "phase": phase,
                "total": ensure_int(
                    total
                ),  # Sometimes a numpy value -> convert to native python type
                "completed": ensure_int(
                    completed
                ),  # Sometimes a numpy value -> convert to native python type
                "device": device_name,
            },
        )

    logging.info("Running diarization")
    diarization = pipeline(audio, hook=_hook)
    logging.info(f"Diarization Result {diarization}")

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segment = Segment(
            start=turn.start * 1000,
            end=turn.end * 1000,
            speakers=[int(speaker.split("_")[1])],
        )
        segments.append(segment)
    segments.sort(key=lambda x: x.start)

    return segments
