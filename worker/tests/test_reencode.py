import logging
from pathlib import Path

import av.logging
import numpy as np
from av.datasets import fate as fate_suite
from transcribee_worker.config import settings
from transcribee_worker.reencode import (
    calculate_new_dimensions,
    get_duration,
    get_video_stream,
    load_audio,
    reencode,
)


def test_load_audio():
    audio = load_audio(fate_suite("aac/Fd_2_c1_Ms_0x01.mp4"))
    assert audio.shape == (480123,)
    assert 0.2 < np.max(audio) < 1.0


def test_get_duration():
    duration = get_duration(Path(fate_suite("aac/Fd_2_c1_Ms_0x01.mp4")))
    assert duration == 30.000023


def test_get_video_stream():
    assert get_video_stream(Path(fate_suite("aac/Fd_2_c1_Ms_0x01.mp4"))) is None
    assert (
        get_video_stream(Path(fate_suite("cover_art/Californication_cover.wma")))
        is None
    )
    assert get_video_stream(Path(fate_suite("h264/direct-bff.mkv"))) is not None


def test_calculate_new_dimensions():
    assert calculate_new_dimensions((1920, 1080), (1920, 1080)) == (1920, 1080)
    assert calculate_new_dimensions((1920, 1080), (854, 480)) == (854, 480)
    assert calculate_new_dimensions((1080, 1920), (854, 480)) == (480, 854)


def test_reencode_audio():
    logging.basicConfig()
    av.logging.set_level(av.logging.TRACE)
    logging.getLogger().setLevel(5)

    reencode(
        fate_suite("mkv/test7_cut.mkv"),
        "/tmp/test.mp3",
        output_params=settings.REENCODE_PROFILES["mp3"],
    )

    reencode(
        fate_suite("mkv/test7_cut.mkv"),
        "/tmp/test.mp4",
        output_params=settings.REENCODE_PROFILES["m4a"],
    )


def test_reencode_video():
    logging.basicConfig()
    av.logging.set_level(av.logging.TRACE)
    logging.getLogger().setLevel(5)
    reencode(
        fate_suite("mkv/test7_cut.mkv"),
        "/tmp/test.mp4",
        output_params=settings.REENCODE_PROFILES["video:mp4"],
    )
