from pathlib import Path
from typing import Dict, List, Optional

import frontmatter
from pydantic import BaseModel, BaseSettings, parse_file_as, parse_obj_as

pages = None


class Settings(BaseSettings):
    storage_path: Path = Path("storage/")
    secret_key = "insecure-secret-key"
    worker_timeout = 60  # in seconds
    media_signature_max_age = 3600  # in seconds
    task_attempt_limit = 5

    media_url_base = "http://localhost:8000/"
    logged_out_redirect_url: None | str = None

    model_config_path: Path = Path("data/models.json")
    pages_dir: Path = Path("data/pages/")


class ModelConfig(BaseModel):
    id: str
    name: str
    languages: List[str]


class PublicConfig(BaseModel):
    models: Dict[str, ModelConfig]
    logged_out_redirect_url: str | None


class ShortPageConfig(BaseModel):
    name: str
    footer_position: Optional[int]


class PageConfig(ShortPageConfig):
    text: str


def get_model_config():
    return parse_file_as(Dict[str, ModelConfig], settings.model_config_path)


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
    return parse_obj_as(Dict[str, ShortPageConfig], get_page_config())


def get_public_config():
    return PublicConfig(
        models=get_model_config(),
        logged_out_redirect_url=settings.logged_out_redirect_url,
    )


settings = Settings()
