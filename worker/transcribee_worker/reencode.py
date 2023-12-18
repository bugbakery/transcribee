import select
import subprocess
from pathlib import Path

import ffmpeg
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import alist, async_task


def get_duration(input_path: Path):
    return float(ffmpeg.probe(input_path)["format"]["duration"])


def readlines(pipes):
    while True:
        fdsin, _, _ = select.select([x.fileno() for x in pipes], [], [])
        for fd in fdsin:
            pipe = next(x for x in pipes if x.fileno() == fd)
            line = pipe.readline()
            if len(line) == 0:
                pipes.remove(pipe)
                continue
            yield pipe, line
        if pipes == []:
            break


async def reencode(
    input_path: Path,
    output_path: Path,
    output_params: dict[str, str],
    progress_callback: ProgressCallbackType,
    duration: float,
    include_video: bool,
):
    def work(_):
        pipeline = ffmpeg.input(input_path)
        streams = [pipeline.audio]
        if include_video:
            streams.append(pipeline.video)

        cmd: subprocess.Popen = ffmpeg.output(
            *streams,
            filename=output_path,
            stats=None,
            progress="-",
            map_metadata="-1",
            **output_params,
        ).run_async(pipe_stdout=True, pipe_stderr=True)
        assert cmd.stdout
        raw_line: bytes
        progress_dict = {}

        stderr_data = []

        for pipe, raw_line in readlines([cmd.stdout, cmd.stderr]):
            if pipe == cmd.stderr:
                stderr_data.append(raw_line.decode())
                continue
            if b"=" not in raw_line:
                continue
            key, value = raw_line.decode().strip().split("=", maxsplit=1)
            progress_dict[key] = value.strip()

            if key == "progress":
                if "out_time_ms" in progress_dict:
                    out_time_ms = int(progress_dict["out_time_ms"])
                    out_time_s = out_time_ms / 1e6
                    progress_callback(
                        progress=out_time_s / duration,
                        extra_data=progress_dict,
                    )
                progress_dict = {}
        returncode = cmd.wait()
        progress_callback(
            progress=1,
            extra_data={"stderr": stderr_data, "returncode": returncode},
        )
        assert returncode == 0, f"{returncode=}"

    await alist(aiter(async_task(work)))
