import argparse

from transcribee_backend.auth import create_api_token
from transcribee_backend.db import SessionContextManager

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    with SessionContextManager(path="management_command:create_api_token") as session:
        token = create_api_token(session=session, name=args.name)
        print(f"Token created: {token.token}")
