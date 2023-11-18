import argparse

from sqlmodel import select
from transcribee_backend import utils
from transcribee_backend.db import SessionContextManager
from transcribee_backend.models import Worker

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--token", required=False)
    args = parser.parse_args()
    if args.token is None:
        args.token = utils.get_random_string()

    with SessionContextManager(path="mangement_comment:create_worker") as session:
        statement = select(Worker).where(Worker.token == args.token)
        results = session.exec(statement)
        existing_worker = results.one_or_none()
        if existing_worker is None:
            worker = Worker(name=args.name, token=args.token, last_seen=None)
            session.add(worker)
            session.commit()
            print(f"Worker with token {args.token} created")
        else:
            print(f"Worker with token {args.token} already exists")
