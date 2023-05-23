from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from transcribee_backend.routers.document import document_router
from transcribee_backend.routers.task import task_router
from transcribee_backend.routers.user import user_router

from .media_storage import serve_media

app = FastAPI()

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware)


app.include_router(user_router, prefix="/api/v1/users")
app.include_router(document_router, prefix="/api/v1/documents")
app.include_router(task_router, prefix="/api/v1/tasks")


@app.get("/")
async def root():
    return {"message": "🎤🐝: *taps mic* bzzp bzzp"}


app.get("/media/{file}")(serve_media)
