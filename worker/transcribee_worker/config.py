import os
from pathlib import Path
from typing import Dict, Optional

from pydantic import BaseSettings


class Settings(BaseSettings):
    SAMPLE_RATE = 16_000  # samples per second
    MODELS_DIR = Path(__file__).parent / ".data" / "models"

    HUGGINGFACE_TOKEN: Optional[str] = None

    REENCODE_PROFILES: Dict[str, Dict[str, str]] = {
        "mp3": {
            "format": "mp3",
            "audio_bitrate": "128k",
            "ac": "1",
        },
        "m4a": {
            "format": "mp4",
            "audio_bitrate": "128k",
            "ac": "1",
        },
        "video:mp4": {
            "format": "mp4",
            "audio_bitrate": "128k",
            "ac": "1",
            "c:v": "libx264",
            "crf": "26",
            "preset": "faster",
            # downscale to 480p and pad to multiple of 2 (needed for libx264)
            "vf": "scale='min(854,iw)':'min(480,ih)'"
            ":force_original_aspect_ratio=decrease,"
            "pad='iw+mod(iw\\,2)':'ih+mod(ih\\,2)",
        },
    }

    KEEPALIVE_INTERVAL: float = 0.5

    CPU_THREADS: int = 4

    COMPUTE_TYPE: str = "int8"

    class Config:
        env_file = ".env"

    def setup_env_vars(self):
        os.environ["PYANNOTE_CACHE"] = str(self.MODELS_DIR)


settings = Settings()
