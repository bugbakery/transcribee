import os
from typing import Any, BinaryIO

import librosa
from transcribee_worker.config import settings


def load_audio(
    path: str | int | os.PathLike[Any] | BinaryIO,
):
    audio, sr = librosa.load(path, sr=settings.SAMPLE_RATE, mono=True)
    return audio
