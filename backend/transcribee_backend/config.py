from pathlib import Path
from typing import Dict, Optional

import frontmatter
from pydantic import BaseModel, TypeAdapter
from pydantic_settings import BaseSettings

pages = None


class Settings(BaseSettings):
    storage_path: Path = Path("storage/")
    secret_key: str = "insecure-secret-key"
    worker_timeout: int = 60  # in seconds
    media_signature_max_age: int = 3600  # in seconds
    task_attempt_limit: int = 5

    media_url_base: str = "http://localhost:8000/"
    logged_out_redirect_url: None | str = None

    pages_dir: Path = Path("data/pages/")

    metrics_username: str = "transcribee"
    metrics_password: str = "transcribee"

    redis_host: str = "localhost"
    redis_port: int = 6379


class PublicConfig(BaseModel):
    logged_out_redirect_url: str | None = None


class ShortPageConfig(BaseModel):
    name: str
    footer_position: Optional[int] = None


class PageConfig(ShortPageConfig):
    text: str


def load_pages_from_disk() -> Dict[str, PageConfig]:
    global pages
    if pages is None:
        pages = {}
        if settings.pages_dir.exists():
            for file in settings.pages_dir.glob("*.md"):
                page_id = file.stem
                page = frontmatter.load(file)
                pages[page_id] = PageConfig(
                    name=page.metadata.get("name", file.stem),
                    footer_position=page.metadata.get("footer_position"),
                    text=page.content,
                )

    return pages


def get_page_config():
    return load_pages_from_disk()


def get_short_page_config() -> Dict[str, ShortPageConfig]:
    return TypeAdapter(Dict[str, ShortPageConfig]).validate_python(get_page_config())


def get_public_config():
    return PublicConfig(
        logged_out_redirect_url=settings.logged_out_redirect_url,
    )


settings = Settings()
