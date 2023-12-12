#!/usr/bin/env python

import argparse
import asyncio
import logging
import os
import signal
import traceback
import urllib.parse
from multiprocessing import Process
from pathlib import Path

import requests.exceptions
from transcribee_worker.config import settings
from watchfiles import watch

logging.basicConfig(level=logging.INFO)

settings.setup_env_vars()


def main():
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
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    if args.websocket_base_url is None:
        sync_url = urllib.parse.urlparse(args.coordinator)
        sync_url = sync_url._replace(path=sync_url.path + "/api/v1/documents/sync/")
        assert sync_url.scheme in ["http", "https"]
        sync_url = sync_url._replace(
            scheme="ws" if sync_url.scheme == "http" else "wss"
        )
        args.websocket_base_url = urllib.parse.urlunparse(sync_url)

    if args.reload:
        logging.info("Reload enabled")
        path = Path(__file__).parent

        stop_watching_event = asyncio.Event()
        p = run_sync_in_process(stop_watching_event, args)

        for _ in watch(path, stop_event=stop_watching_event):
            logging.info("Source code change detected, reloading worker")
            p.terminate()
            p.join()
            p = run_sync_in_process(stop_watching_event, args)

    else:
        run_sync(args)


def run_sync_in_process(stop_watching_event: asyncio.Event, args):
    p = Process(target=run_sync, args=(args,))
    p.start()

    def handle_signal(sig, *args):
        """
        Passes signals received by the watcher process to the actual worker process and
        stops watching if shutdown is requested.
        """
        if p.pid is None:
            raise Exception("Process has no PID")

        os.kill(p.pid, sig)

        if sig == signal.SIGTERM:
            stop_watching_event.set()
        elif sig == signal.SIGUSR1:
            stop_watching_event.clear()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGUSR1, handle_signal)

    return p


def run_sync(args):
    asyncio.run(run(args))


async def wait_for_event(event: asyncio.Event, timeout: int):
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass


async def run(args):
    # Needs to be done after settings.setup_env
    from transcribee_worker.worker import Worker  # noqa

    finish_event = asyncio.Event()

    def shutdown():
        logging.info("Gracefully shutting down...")
        finish_event.set()

    def cancel_shutdown():
        finish_event.clear()
        logging.info("Shutdown canceled")

    loop = asyncio.get_running_loop()
    # stop the worker gracefully on SIGTERM
    loop.add_signal_handler(signal.SIGTERM, shutdown)
    # allow to cancel shutdown via SIGUSR1
    loop.add_signal_handler(signal.SIGUSR1, cancel_shutdown)

    worker = Worker(
        base_url=f"{args.coordinator}/api/v1/tasks",
        websocket_base_url=args.websocket_base_url,
        token=args.token,
    )
    while not finish_event.is_set():
        try:
            no_work = await worker.run_task(
                mark_completed=not args.run_once_and_dont_complete
            )
            if no_work:
                await wait_for_event(finish_event, timeout=5)
            elif args.run_once_and_dont_complete:
                break
        except requests.exceptions.ConnectionError:
            logging.warn("could not connect to backend")
            await wait_for_event(finish_event, timeout=5)
        except Exception:
            logging.warn(
                f"an error occured during worker execution:\n{traceback.format_exc()}"
            )
            await wait_for_event(finish_event, timeout=5)


if __name__ == "__main__":
    main()
