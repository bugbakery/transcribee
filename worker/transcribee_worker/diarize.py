import logging
from typing import List

from pyannote.audio import Pipeline
from pyannote.core.json import dumps
from transcribee_proto.document import Segment

from .config import settings


def diarize(audio, progress_callback) -> List[Segment]:
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization@2.1",
        use_auth_token=settings.HUGGINGFACE_TOKEN,
        cache_dir=settings.MODELS_DIR,
    )

    def _hook(phase, *args, **kwargs):
        total = kwargs.pop("total", None)
        completed = kwargs.pop("completed", None)
        phases = {
            "segmentation": {"scale": 0.2, "offset": 0},
            "embeddings": {"scale": 0.8, "offset": 0.2},
        }
        if total is not None and completed is not None and phase in phases:
            progress_callback(
                phases[phase]["offset"] + (completed / total) * phases[phase]["scale"]
            )

    logging.info("Running diarization")
    diarization = pipeline(audio, hook=_hook)
    logging.info("Diarization Result %s", dumps(diarization))

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
