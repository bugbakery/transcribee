from fastapi import APIRouter

from transcribee_backend.config import PublicConfig, get_public_config

config_router = APIRouter()


@config_router.get("/")
def get_config() -> PublicConfig:
    return get_public_config()
