import asyncio

from aioprometheus.asgi.middleware import MetricsMiddleware
from aioprometheus.asgi.starlette import metrics
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from transcribee_backend.config import settings
from transcribee_backend.helpers.periodic_tasks import run_periodic
from transcribee_backend.helpers.tasks import remove_expired_tokens, timeout_attempts
from transcribee_backend.routers.config import config_router
from transcribee_backend.routers.document import document_router
from transcribee_backend.routers.page import page_router
from transcribee_backend.routers.task import task_router
from transcribee_backend.routers.user import user_router
from transcribee_backend.routers.worker import worker_router

from .media_storage import serve_media

app = FastAPI()
app.add_middleware(MetricsMiddleware)
app.add_route("/metrics", metrics)


origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(user_router, prefix="/api/v1/users")
app.include_router(document_router, prefix="/api/v1/documents")
app.include_router(task_router, prefix="/api/v1/tasks")
app.include_router(config_router, prefix="/api/v1/config")
app.include_router(page_router, prefix="/api/v1/page")
app.include_router(worker_router, prefix="/api/v1/worker")


@app.get("/")
async def root():
    return {"message": "🎤🐝: *taps mic* bzzp bzzp"}


app.get("/media/{file}")(serve_media)


@app.on_event("startup")
async def setup_periodic_tasks():
    asyncio.create_task(
        run_periodic(timeout_attempts, seconds=min(30, settings.worker_timeout))
    )
    asyncio.create_task(run_periodic(remove_expired_tokens, seconds=60 * 60))  # 1 hour
