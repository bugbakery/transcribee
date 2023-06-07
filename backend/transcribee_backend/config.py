from pathlib import Path

from pydantic import BaseSettings


class Settings(BaseSettings):
    storage_path: Path = Path("storage/")
    secret_key = "insecure-secret-key"
    worker_timeout = 60  # in seconds
    media_signature_max_age = 3600  # in seconds
    task_attempt_limit = 5

    media_url_base = "http://localhost:8000/"


settings = Settings()
