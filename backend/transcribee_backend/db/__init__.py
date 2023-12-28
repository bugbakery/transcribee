import os
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from fastapi import Request
from prometheus_client import Histogram
from prometheus_fastapi_instrumentator import routing
from redis.asyncio import Redis
from sqlalchemy import event
from sqlmodel import Session, create_engine
from starlette.websockets import WebSocket

from transcribee_backend.config import settings
from transcribee_backend.util.redis_task_channel import RedisTaskChannel

DEFAULT_SOCKET_PATH = Path(__file__).parent.parent.parent / "db" / "sockets"

DATABASE_URL = os.environ.get(
    "TRANSCRIBEE_BACKEND_DATABASE_URL",
    f"postgresql:///transcribee?host={DEFAULT_SOCKET_PATH}",
)

engine = create_engine(
    DATABASE_URL,
    pool_size=32,
    max_overflow=1024,  # we keep open a database connection for every worker
)
redis = Redis(host=settings.redis_host, port=settings.redis_port)
redis_task_channel = RedisTaskChannel(redis)

query_histogram = Histogram(
    "sql_queries",
    "Number of sql queries executed per db session",
    ["path"],
    buckets=[1, 2, 4, 8, 16, 32, 128, 256, 512],
)


def get_redis_task_channel():
    return redis_task_channel


def get_session(request: Request):
    handler = routing.get_route_name(request)
    with Session(engine) as session, query_counter(session, path=handler):
        yield session


def get_session_ws(websocket: WebSocket):
    # get_route_name is typed with a Request, but in reality a HttpConnection
    # (which WebSocket is) is enough
    handler = routing.get_route_name(websocket)  # type: ignore
    with Session(engine) as session, query_counter(session, path=handler):
        yield session


@contextmanager
def SessionContextManager(path: str):
    with Session(engine) as session, query_counter(session, path=path):
        yield session


@contextmanager
def query_counter(session: Session, path: Optional[str]):
    count = 0

    def callback(*args, **kwargs):
        nonlocal count
        count += 1

    event.listen(session, "do_orm_execute", callback)
    yield
    event.remove(session, "do_orm_execute", callback)
    query_histogram.labels(path=path).observe(count)
