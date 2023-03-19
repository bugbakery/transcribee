#!/usr/bin/env python

import argparse
import asyncio
import json
import logging

import automerge
from transcribee_proto.api import TaskType
from transcribee_worker.worker import Worker

logging.basicConfig(level=logging.INFO)


async def main():
    parser = argparse.ArgumentParser(
        description="Dump the current state of a document to stdout"
    )
    parser.add_argument(
        "--websocket-base-url",
        help="url to the websocket sync server (aka the transcribee backend)",
        default="ws://localhost:8000/sync/",
    )
    parser.add_argument("--token", help="Worker token", required=True)
    parser.add_argument("--doc-id", required=True)
    args = parser.parse_args()

    worker = Worker(
        base_url="",
        websocket_base_url=args.websocket_base_url,
        token=args.token,
        task_types=[TaskType.TRANSCRIBE],
    )
    print(json.dumps(automerge.dump(await worker.get_document_state(args.doc_id))))


if __name__ == "__main__":
    asyncio.run(main())
