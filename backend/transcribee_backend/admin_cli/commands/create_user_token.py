import datetime

from sqlmodel import select
from transcribee_backend.admin_cli.command import Command
from transcribee_backend.auth import generate_user_token
from transcribee_backend.db import SessionContextManager
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models.user import User


class CreateUserTokenCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--valid-days", required=True)

    def run(self, args):
        with SessionContextManager(
            path="management_command:create_user_token"
        ) as session:
            valid_days = int(args.valid_days)
            if valid_days < 0:
                print("Valid days must be positive")
                exit(1)

            valid_until = now_tz_aware() + datetime.timedelta(days=valid_days)

            user = session.exec(
                select(User).where(User.username == args.username)
            ).one_or_none()

            if user is None:
                print(f"User {args.user} not found")
                exit(1)

            key, user_token = generate_user_token(user, valid_until=valid_until)
            session.add(user_token)
            session.commit()

            print(f"User token created and valid until {valid_until}")
            print(f"Secret: {key}")
