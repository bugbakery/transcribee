import random
import string

from transcribee_backend.admin_cli.command import Command
from transcribee_backend.auth import create_user
from transcribee_backend.db import SessionContextManager
from transcribee_backend.exceptions import UserAlreadyExists


def random_password():
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(20))


class CreateUserCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument("--user", required=True)
        parser.add_argument("--password", required=False)

    def run(self, args):
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
                create_user(session=session, username=args.user, password=password)
                print("User created")
            except UserAlreadyExists:
                print("Could not create user. A user with that name already exists.")
