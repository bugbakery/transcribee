from transcribee_backend.admin_cli.command import Command
from transcribee_backend.auth import create_api_token
from transcribee_backend.db import SessionContextManager


class CreateApiTokenCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument("--name", required=True)

    def run(self, args):
        with SessionContextManager(
            path="management_command:create_api_token"
        ) as session:
            token = create_api_token(session=session, name=args.name)
            print(f"Token created: {token.token}")
