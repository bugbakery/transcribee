#!/usr/bin/env python

import argparse
import asyncio
import logging
import traceback

import requests.exceptions
from transcribee_proto.api import TaskType
from transcribee_worker.worker import Worker

logging.basicConfig(level=logging.DEBUG)


async def main():
    parser = argparse.ArgumentParser(
        description="The worker for the transcribee open source transcription platform"
    )
    parser.add_argument(
        "--coordinator",
        help="url to the task coordinator (aka the transcribee backend)",
        default="http://localhost:8000",
    )
    parser.add_argument("--token", help="Worker token", required=True)
    args = parser.parse_args()

    worker = Worker(
        base_url=f"{args.coordinator}/api/v1/tasks",
        token=args.token,
        task_types=[TaskType.TRANSCRIBE],
    )
    while True:
        try:
            no_work = await worker.run_task()
            if no_work:
                await asyncio.sleep(5)
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
