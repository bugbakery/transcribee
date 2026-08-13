import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Literal, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


@dataclass
class AudioOptions:
    codec: str
    channels: str
    bitrate: str


@dataclass
class VideoOptions:
    codec: str
    crf: int
    preset: str
    width: int
    height: int


@dataclass
class OutputProfile:
    container: str
    audio: AudioOptions
    video: VideoOptions | None
    for_audio: bool
    for_video: bool


class Settings(BaseSettings):
    SAMPLE_RATE: int = 16_000  # samples per second
    MODELS_DIR: Path = Path(__file__).parent / ".data" / "models"

    HUGGINGFACE_TOKEN: Optional[str] = None

    REENCODE_PROFILES: Dict[str, OutputProfile] = {
        "mp3": OutputProfile(
            container="mp3",
            audio=AudioOptions(codec="mp3", channels="mono", bitrate="128k"),
            video=None,
            for_audio=True,
            for_video=True,
        ),
        "m4a": OutputProfile(
            container="mp4",
            audio=AudioOptions(codec="aac", channels="mono", bitrate="128k"),
            video=None,
            for_audio=True,
            for_video=True,
        ),
        "video:mp4": OutputProfile(
            container="mp4",
            audio=AudioOptions(codec="aac", channels="mono", bitrate="128k"),
            video=VideoOptions(
                codec="libx264", crf=26, preset="faster", width=854, height=480
            ),
            for_audio=False,
            for_video=True,
        ),
    }
    REENCODE_PROFILES_DESKTOP: Dict[str, OutputProfile] = {
        # we only reencode one version for desktop (no need to save bandwidth)
        # in only loading the audio if video preview is disabled.
        # transcribee-desktop also currently only supports having one reencoded version per
        # document. Thus you need to make sure, that there is only one OutputProfile with
        # for_audio=True and one OutputProfile with for_video=True
        "m4a": OutputProfile(
            container="mp4",
            audio=AudioOptions(codec="aac", channels="mono", bitrate="128k"),
            video=None,
            for_audio=True,
            for_video=False,
        ),
        "video:mp4": OutputProfile(
            container="mp4",
            audio=AudioOptions(codec="aac", channels="mono", bitrate="128k"),
            video=VideoOptions(
                codec="libx264", crf=26, preset="faster", width=854, height=480
            ),
            for_audio=False,
            for_video=True,
        ),
    }

    WORKER_TYPE: Literal["web", "desktop"] = "web"

    model_config = SettingsConfigDict(env_file=".env")

    def setup_env_vars(self):
        os.environ["PYANNOTE_CACHE"] = str(self.MODELS_DIR)


settings = Settings()
