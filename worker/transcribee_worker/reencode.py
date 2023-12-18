import subprocess
from pathlib import Path

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
    def work(_):
        pipeline = ffmpeg.input(input_path)
        streams = [pipeline["a:0"]]  # use only first audio stream
        if include_video:
            streams.append(pipeline.video)

        cmd: subprocess.Popen = ffmpeg.output(
            *streams,
            filename=output_path,
            loglevel="quiet",
            stats=None,
            progress="-",
            map_metadata="-1",
            **output_params
        ).run_async(pipe_stdout=True)
        assert cmd.stdout
        raw_line: bytes
        progress_dict = {}
        for raw_line in cmd.stdout:
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

    await alist(aiter(async_task(work)))
