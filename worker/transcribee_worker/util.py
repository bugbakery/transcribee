import os
import subprocess
import sys
from typing import Any, Tuple

import numpy as np
import numpy.typing as npt
from transcribee_worker.config import settings


def load_audio(path: str | os.PathLike[Any]) -> Tuple[npt.NDArray, int]:
    sr = settings.SAMPLE_RATE
    command = [
        "ffmpeg",
        "-i",
        str(path),
        "-f",
        "f32le",
        "-ar",
        str(sr),
        "-ac",
        "1",
        "-",
    ]
    bytes = subprocess.check_output(command, stderr=sys.stderr)
    audio = np.frombuffer(bytes, dtype=np.dtype("float32"))
    return audio, sr
