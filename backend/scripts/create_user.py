import argparse

from transcribee_backend.auth import create_user
from transcribee_backend.db import get_session
from transcribee_backend.exceptions import UserAlreadyExists

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--pass", required=True)
    args = parser.parse_args()
    session = next(get_session())
    try:
        user = create_user(
            session=session, username=args.user, password=getattr(args, "pass")
        )
        print("User created")
    except UserAlreadyExists:
        print("Could not create user. A user with that name already exists.")
