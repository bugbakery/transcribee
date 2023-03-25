#!/usr/bin/env python

import argparse
import asyncio
import logging
import traceback
import urllib.parse

import requests.exceptions
from transcribee_proto.api import TaskType
from transcribee_worker.worker import Worker

logging.basicConfig(level=logging.INFO)


async def main():
    parser = argparse.ArgumentParser(
        description="The worker for the transcribee open source transcription platform"
    )
    parser.add_argument(
        "--coordinator",
        help="url to the task coordinator (aka the transcribee backend)",
        default="http://localhost:8000",
    )
    parser.add_argument(
        "--websocket-base-url",
        help=(
            "url to the websocket sync server (aka the transcribee backend), "
            "default: {coordinator}/sync/"
        ),
        default=None,
    )
    parser.add_argument("--token", help="Worker token", required=True)
    parser.add_argument("--run-once-and-dont-complete", action="store_true")
    args = parser.parse_args()

    if args.websocket_base_url is None:
        sync_url = urllib.parse.urlparse(args.coordinator)
        sync_url = sync_url._replace(path=sync_url.path + "/sync/")
        assert sync_url.scheme in ["http", "https"]
        sync_url = sync_url._replace(
            scheme="ws" if sync_url.scheme == "http" else "wss"
        )
        args.websocket_base_url = urllib.parse.urlunparse(sync_url)

    worker = Worker(
        base_url=f"{args.coordinator}/api/v1/tasks",
        websocket_base_url=args.websocket_base_url,
        token=args.token,
        task_types=[TaskType.TRANSCRIBE],
    )
    while True:
        try:
            no_work = await worker.run_task()
            if no_work:
                await asyncio.sleep(5)
            elif args.run_once_and_dont_complete:
                break
        except requests.exceptions.ConnectionError:
            logging.warn("could not connect to backend")
            await asyncio.sleep(5)
        except Exception:
            logging.warn(
                f"an error occured during worker execution:\n{traceback.format_exc()}"
            )
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
