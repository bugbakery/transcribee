from pathlib import Path
from typing import Dict, List

from pydantic import BaseSettings, parse_file_as
from pydantic.main import BaseModel


class Settings(BaseSettings):
    storage_path: Path = Path("storage/")
    secret_key = "insecure-secret-key"
    worker_timeout = 60  # in seconds
    media_signature_max_age = 3600  # in seconds
    task_attempt_limit = 5

    debug_mode = False

    media_url_base = "http://localhost:8000/"

    model_config_path: Path = Path("data/models.json")

    class Config:
        env_file = ".env"


class ModelConfig(BaseModel):
    id: str
    name: str
    languages: List[str]


class PublicConfig(BaseModel):
    models: Dict[str, ModelConfig]
    debug_mode: bool


def get_model_config():
    return parse_file_as(Dict[str, ModelConfig], settings.model_config_path)


def get_public_config():
    return PublicConfig(models=get_model_config(), debug_mode=settings.debug_mode)


settings = Settings()
