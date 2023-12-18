import logging
import subprocess
from pathlib import Path
from threading import Thread
from typing import IO

import ffmpeg
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import alist, async_task


def get_duration(input_path: Path):
    return float(ffmpeg.probe(input_path)["format"]["duration"])


async def reencode(
    input_path: Path,
    output_path: Path,
    output_params: dict[str, str],
    progress_callback: ProgressCallbackType,
    duration: float,
    include_video: bool,
):
    def read_progress(stdout: IO):
        for raw_line in stdout:
            key, value = raw_line.decode().strip().split("=", maxsplit=1)

            if key == "out_time_ms":
                out_time_ms = int(value)
                out_time_s = out_time_ms / 1e6
                progress_callback(
                    progress=out_time_s / duration,
                )

    def work(_):
        pipeline = ffmpeg.input(input_path)
        streams = [pipeline["a:0"]]  # use only first audio stream
        if include_video:
            streams.append(pipeline.video)

        cmd: subprocess.Popen = ffmpeg.output(
            *streams,
            filename=output_path,
            stats=None,
            progress="-",
            map_metadata="-1",
            **output_params,
        ).run_async(pipe_stderr=True, pipe_stdout=True)
        assert cmd.stderr
        assert cmd.stdout

        Thread(target=read_progress, args=(cmd.stdout,)).start()

        stderr_data = []
        for raw_line in cmd.stderr:
            line = raw_line.decode().rstrip()
            logging.info(line)
            stderr_data.append(line)

        returncode = cmd.wait()
        progress_callback(
            progress=1,
            extra_data={"stderr": stderr_data, "returncode": returncode},
        )
        assert returncode == 0, f"{returncode=}"

    await alist(aiter(async_task(work)))
