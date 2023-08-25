from typing import Dict

from fastapi import APIRouter, HTTPException

from transcribee_backend.config import (
    PageConfig,
    ShortPageConfig,
    get_page_config,
    get_short_page_config,
)

page_router = APIRouter()


@page_router.get("/")
def get_pages() -> Dict[str, ShortPageConfig]:
    return get_short_page_config()


@page_router.get("/{page_id}", responses={404: {"description": "Page not found"}})
def get_page(page_id: str) -> PageConfig:
    pages = get_page_config()
    if page_id not in pages:
        raise HTTPException(status_code=404)
    return pages[page_id]
