import argparse
import random
import string

from transcribee_backend.auth import create_user
from transcribee_backend.db import SessionContextManager
from transcribee_backend.exceptions import UserAlreadyExists


def random_password():
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(20))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=False)
    args = parser.parse_args()

    password = args.password

    if not password:
        password = random_password()

        print("Auto-generated password.")
        print("Infos to send to user:")
        print()
        print(f"Username: {args.user}")
        print(f"Password: {password} (Please change)")
        print()

    with SessionContextManager(path="management_command:create_user") as session:
        try:
            user = create_user(session=session, username=args.user, password=password)
            print("User created")
        except UserAlreadyExists:
            print("Could not create user. A user with that name already exists.")
