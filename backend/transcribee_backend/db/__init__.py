import os
from contextlib import contextmanager
from pathlib import Path

from sqlmodel import Session, create_engine

DEFAULT_SOCKET_PATH = Path(__file__).parent.parent.parent / "db" / "sockets"

DATABASE_URL = os.environ.get(
    "TRANSCRIBEE_BACKEND_DATABASE_URL",
    f"postgresql:///transcribee?host={DEFAULT_SOCKET_PATH}",
)

engine = create_engine(DATABASE_URL)


def get_session():
    with Session(engine) as session:
        yield session


SessionContextManager = contextmanager(get_session)
