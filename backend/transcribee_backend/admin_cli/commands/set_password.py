from transcribee_backend.admin_cli.command import Command
from transcribee_backend.auth import change_user_password
from transcribee_backend.db import SessionContextManager
from transcribee_backend.exceptions import UserDoesNotExist


class SetPasswordCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument("--user", required=True)
        parser.add_argument("--pass", required=True)

    def run(self, args):
        with SessionContextManager(path="management_command:set_password") as session:
            try:
                change_user_password(
                    session=session,
                    username=args.user,
                    new_password=getattr(args, "pass"),
                )
                print("Password changed")
            except UserDoesNotExist:
                print("User does not exists")
