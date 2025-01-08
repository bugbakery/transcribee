#!/usr/bin/env python

import argparse

from transcribee_backend.auth import change_user_password
from transcribee_backend.db import SessionContextManager
from transcribee_backend.exceptions import UserDoesNotExist

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--pass", required=True)
    args = parser.parse_args()

    with SessionContextManager(path="management_command:set_password") as session:
        try:
            user = change_user_password(
                session=session, username=args.user, new_password=getattr(args, "pass")
            )
            print("Password changed")
        except UserDoesNotExist:
            print("User does not exists")
