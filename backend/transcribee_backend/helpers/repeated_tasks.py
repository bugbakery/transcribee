import asyncio
import logging
from typing import Callable

from starlette.concurrency import run_in_threadpool


async def repeat(func: Callable, seconds: int):
    is_coroutine = asyncio.iscoroutinefunction(func)

    while True:
        try:
            if is_coroutine:
                await func()
            else:
                await run_in_threadpool(func)
        except Exception as exc:
            logging.error("Repeating task failed", exc_info=exc)
        await asyncio.sleep(seconds)
