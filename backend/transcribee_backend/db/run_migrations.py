#!/usr/bin/env python

from os import path

from alembic import command
from alembic.config import Config


def main():
    alembic_cfg = Config()
    alembic_cfg.set_main_option(
        "script_location",
        path.join(path.dirname(path.realpath(__file__)), "migrations"),
    )
    command.upgrade(alembic_cfg, "head")


if __name__ == "__main__":
    main()
