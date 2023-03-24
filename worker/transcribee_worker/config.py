import os
from pathlib import Path
from typing import Optional

from pydantic import BaseSettings


class Settings(BaseSettings):
    SAMPLE_RATE = 16_000  # samples per second
    MODELS_DIR = Path(__file__).parent / ".data" / "models"

    HUGGINGFACE_TOKEN: Optional[str] = None

    class Config:
        env_file = ".env"

    def setup_env_vars(self):
        os.environ["PYANNOTE_CACHE"] = str(self.MODELS_DIR)


settings = Settings()
