from math import pi, sqrt
from pathlib import Path

import av
import numpy as np
import numpy.typing as npt
from av import AudioFrame, AudioStream, VideoFrame, VideoStream
from av.audio.resampler import AudioResampler
from av.codec.context import ThreadType
from av.container import InputContainer
from av.filter.graph import Graph
from transcribee_worker.config import OutputProfile, settings
from transcribee_worker.types import ProgressCallbackType


def as_input_container(x: Path | str | InputContainer):
    if isinstance(x, InputContainer):
        return x
    else:
        return av.open(str(x))


def load_audio(x: Path | str | InputContainer) -> npt.NDArray[np.float32]:
    input_file = as_input_container(x)
    input_stream = input_file.streams.audio[0]
    resampler = AudioResampler(format="s16", layout="mono", rate=settings.SAMPLE_RATE)
    frames = []
    for frame in input_file.decode(input_stream):
        for new_frame in resampler.resample(frame):
            frames.append(new_frame.to_ndarray()[0])
    to_return = np.concatenate(frames, dtype=np.float32)
    to_return /= (
        2**15
    )  # we get 16 bit frames from ffmpeg, this normalizes to [-1, +1]
    return to_return


def get_duration(x: Path | str | InputContainer):
    """return the duration in seconds for the given media

    Args:
        x (Path | str | InputContainer): the media

    Returns:
        float: the duration in seconds
    """
    input_file = as_input_container(x)
    assert input_file.duration is not None
    return (
        input_file.duration / 1e6
    )  # for some reason InputContainer.duration is in microseconds


def get_video_stream(x: Path | str | InputContainer) -> av.VideoStream | None:
    input_file = as_input_container(x)
    video_streams = [
        v
        for v in input_file.streams.video
        if v.disposition.name != "attached_pic"  # ignore cover art
    ]
    if len(video_streams) > 0:
        return video_streams[0]


def calculate_new_dimensions(prev, target):
    """calculate new dimensions that have the same aspect ratio as prev but the same number of
    pixels as target

    Args:
        prev (Tuple[int, int]): the original aspect ratio (w, h)
        target (Tuple[int, int]): the target size (w, h)

    Returns:
        Tuple[int, int]: the resulting size (w, h)
    """
    w, h = prev
    wt, ht = target
    factor = sqrt((wt * ht) / (w * h))
    return int(round(w * factor)) // 2 * 2, int(round(h * factor)) // 2 * 2


def reencode(
    input_path: Path | str | InputContainer,
    output_path: Path | str,
    output_params: OutputProfile,
    progress_callback: ProgressCallbackType | None = None,
):
    input_container = as_input_container(input_path)
    total_length = get_duration(input_container)
    assert total_length is not None
    output_container = av.open(
        str(output_path),
        mode="w",
        format=output_params.container,
        options=dict(movflags="+faststart"),
    )

    audio_input_stream = input_container.streams.audio[0]
    audio_output_stream = output_container.add_stream(
        output_params.audio.codec,
        audio_input_stream.rate,
    )
    assert isinstance(audio_output_stream, AudioStream)
    video_output_stream = None
    video_filter_graph = None
    if (
        video_stream := get_video_stream(input_container)
    ) and output_params.video is not None:
        video_stream.thread_count = 0  # automatic number of threads
        video_stream.thread_type = ThreadType.AUTO
        sar = 1.0
        if video_stream.sample_aspect_ratio is not None:
            sar = float(video_stream.sample_aspect_ratio)
        new_w, new_h = calculate_new_dimensions(
            (video_stream.width, video_stream.height / sar),
            (output_params.video.width, output_params.video.height),
        )
        video_output_stream = output_container.add_stream(
            output_params.video.codec,
            time_base=video_stream.time_base,
            width=new_w,
            height=new_h,
            options=dict(
                crf=str(output_params.video.crf), preset=output_params.video.preset
            ),
            thread_count=0,  # automatic number of threads
            thread_type=ThreadType.AUTO,
        )
        assert isinstance(video_output_stream, VideoStream)

    for packet in input_container.demux():
        if packet.stream == audio_input_stream:
            for frame in packet.decode():
                assert isinstance(frame, AudioFrame)
                output_container.mux(audio_output_stream.encode(frame))
                if frame.pts is not None and progress_callback is not None:
                    time = float(frame.pts * packet.time_base)
                    progress_callback(progress=time / total_length)
        elif video_output_stream is not None and packet.stream == video_stream:
            for frame in packet.decode():
                assert isinstance(frame, VideoFrame)
                rotation = frame.rotation
                if rotation < 0:
                    rotation = 360 + rotation
                if frame.rotation != 0:
                    # it seems like it is currently not possible to write the displaymatrix side
                    # data field using pyav (see https://github.com/PyAV-Org/PyAV/discussions/1629).
                    # thus, we rotate the frames manually here.
                    if video_filter_graph is None:
                        video_filter_graph = Graph()
                        video_filter_graph.link_nodes(
                            video_filter_graph.add_buffer(video_stream),
                            video_filter_graph.add("rotate", str(rotation * pi / 180)),
                            video_filter_graph.add("buffersink"),
                        )
                    video_filter_graph.vpush(frame)
                    frame = video_filter_graph.vpull()
                output_container.mux(video_output_stream.encode(frame))
    output_container.mux(audio_output_stream.encode(None))
    if video_output_stream is not None:
        output_container.mux(video_output_stream.encode(None))
    output_container.close()
