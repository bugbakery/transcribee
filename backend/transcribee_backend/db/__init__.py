import os

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, create_engine


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


DATABASE_URL = os.environ.get("TRANSCRIBEE_BACKEND_DATABASE_URL", "sqlite:///db.sqlite")

connect_args = {}
if DATABASE_URL.startswith("sqlite://"):
    connect_args = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def get_session():
    with Session(engine) as session:
        yield session
