import argparse

from .command import Command
from .commands.create_api_token import CreateApiTokenCmd
from .commands.create_user import CreateUserCmd
from .commands.create_user_token import CreateUserTokenCmd
from .commands.create_worker import CreateWorkerCmd
from .commands.reset_task import ResetTaskCmd
from .commands.set_password import SetPasswordCmd

parser = argparse.ArgumentParser()
subparsers = parser.add_subparsers(required=True, title="commands")


def add_command(name: str, description: str, command: Command):
    subparser = subparsers.add_parser(name, help=description, description=description)
    command.configure_parser(subparser)
    subparser.set_defaults(func=command.run)


# all commands belong here
add_command("create_api_token", "Create an API token", CreateApiTokenCmd())
add_command("create_user_token", "Create an user token", CreateUserTokenCmd())
add_command("create_user", "Create a new user", CreateUserCmd())
add_command("create_worker", "Register a new worker", CreateWorkerCmd())
add_command("reset_task", "Reset a task", ResetTaskCmd())
add_command("set_password", "Set the password of a user", SetPasswordCmd())


def main():
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
