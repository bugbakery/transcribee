import asyncio
import os
import subprocess
import sys
from typing import Any, Tuple

import numpy as np
import numpy.typing as npt
from transcribee_worker.config import settings


def load_audio(path: str | os.PathLike[Any]) -> Tuple[npt.NDArray, int]:
    sr = settings.SAMPLE_RATE
    command = [
        "ffmpeg",
        "-i",
        str(path),
        "-f",
        "f32le",
        "-ar",
        str(sr),
        "-ac",
        "1",
        "-",
    ]
    bytes = subprocess.check_output(command, stderr=sys.stderr)
    audio = np.frombuffer(bytes, dtype=np.dtype("float32"))
    return audio, sr


class WorkDoneToken:
    ...


class SubmissionQueue:
    def __init__(self, loop, queue):
        self.loop = loop
        self.queue = queue

    def submit(self, item):
        # asyncio.Queue is not threadsafe, so we need to use the *_threadsafe functions
        self.loop.call_soon_threadsafe(self.queue.put_nowait, item)


async def async_task(generator, *args, **kwargs):
    loop = asyncio.get_running_loop()
    results_queue = asyncio.Queue()

    def _work_task(result_queue, work_function):
        work_function(SubmissionQueue(loop, result_queue), *args, **kwargs)
        return WorkDoneToken()

    work = loop.run_in_executor(None, _work_task, results_queue, generator)

    pending = {asyncio.create_task(results_queue.get()), work}

    run = True
    while run:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for fut in done:
            value = fut.result()
            if isinstance(value, WorkDoneToken):
                run = False
            else:
                yield value

                while not results_queue.empty():
                    yield results_queue.get_nowait()

        # If we are still running, `_work_task` cannot have returend, i.e. we got an
        # element from the results queue. -> We need to add a new `results_queue.get`-Task
        if run:
            pending.add(asyncio.create_task(results_queue.get()))

    for task in pending:
        task.cancel()


async def aenumerate(iterable, start=0):
    n = start
    async for elem in iterable:
        yield n, elem
        n += 1


async def alist(iterable):
    return [item async for item in iterable]
