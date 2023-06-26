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

    media_url_base = "http://localhost:8000/"

    model_config_path: Path = Path("data/models.json")


class ModelConfig(BaseModel):
    id: str
    name: str
    languages: List[str]


class PublicConfig(BaseModel):
    models: Dict[str, ModelConfig]


def get_model_config():
    return parse_file_as(Dict[str, ModelConfig], settings.model_config_path)


def get_public_config():
    return PublicConfig(models=get_model_config())


settings = Settings()
