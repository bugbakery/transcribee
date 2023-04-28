import os

from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("TRANSCRIBEE_BACKEND_DATABASE_URL", "sqlite:///db.sqlite")

connect_args = {}
if DATABASE_URL.startswith("sqlite://"):
    connect_args = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def init_db():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
