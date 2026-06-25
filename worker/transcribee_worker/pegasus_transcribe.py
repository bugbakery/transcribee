"""Transcription backend using the TwelveLabs Pegasus video-understanding model.

This is an opt-in alternative to the default local whisper backend. It indexes
the document media into a TwelveLabs index and asks Pegasus to produce a timed
transcript, which is then converted into transcribee ``Paragraph``s.

Pegasus is a *video* understanding model, so the media must contain a video
track of at least 360x360. Audio-only files (the common transcription case) are
therefore wrapped in a minimal black video track via ffmpeg before indexing.

Enable it by setting ``TRANSCRIPTION_BACKEND=pegasus`` and ``TWELVELABS_API_KEY``
in the worker environment. Get a free API key at https://twelvelabs.io.
"""

import json
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

from transcribee_proto.document import Atom, Paragraph

from transcribee_worker.config import settings
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import SubmissionQueue, async_task

# Pegasus is generative, so we constrain its output to a strict JSON shape we
# can parse deterministically instead of free-form prose.
_TRANSCRIBE_PROMPT = (
    "Transcribe the spoken audio of this media verbatim. Respond with ONLY a "
    "JSON object of the form "
    '{"segments": [{"start": <seconds>, "end": <seconds>, "text": "..."}]}. '
    "Split the transcript into one segment per sentence or natural pause. "
    "`start` and `end` are floating point seconds from the beginning of the "
    "media. Do not include any commentary, markdown or code fences."
)

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

# TwelveLabs requires indexed videos to be at least 360x360.
_MIN_DIMENSION = 360


def parse_pegasus_segments(
    raw: str, lang: str, start_offset: float = 0.0
) -> List[Paragraph]:
    """Parse Pegasus' JSON transcript into transcribee paragraphs.

    Tolerates the model wrapping the JSON in prose or ```json fences by
    extracting the outermost JSON object. Each segment becomes one paragraph
    with a single atom; confidence is unknown so we report 1.0.
    """
    match = _JSON_RE.search(raw)
    if match is None:
        raise ValueError(f"Pegasus response contained no JSON object: {raw!r}")

    segments = json.loads(match.group(0)).get("segments", [])
    paragraphs: List[Paragraph] = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        start = float(seg["start"]) + start_offset
        end = float(seg["end"]) + start_offset
        paragraphs.append(
            Paragraph(
                lang=lang,
                children=[
                    Atom(
                        text=text,
                        start=start,
                        end=max(start, end),
                        conf=1.0,
                        conf_ts=0.0,
                    )
                ],
            )
        )
    return paragraphs


def _ensure_indexable_video(media_path: Path, workdir: Path) -> Path:
    """Return a path Pegasus can index.

    If the media already has a video stream we assume it is indexable and use
    it directly. Audio-only media is wrapped in a 360x360 black video track so
    the (video-only) Pegasus model accepts it.
    """
    # Imported lazily so the JSON parser stays usable without PyAV installed.
    from transcribee_worker.reencode import get_video_stream

    if get_video_stream(media_path) is not None:
        return media_path

    out = workdir / "pegasus_input.mp4"
    # ponytail: shell out to the bundled ffmpeg binary; synthesizing a black
    # video stream via PyAV is far more code for the same result.
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={_MIN_DIMENSION}x{_MIN_DIMENSION}:r=1",
            "-i",
            str(media_path),
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    return out


def _get_or_create_index(client) -> str:
    """Return the id of the configured Pegasus index, creating it if needed."""
    for index in client.indexes.list():
        if index.index_name == settings.PEGASUS_INDEX_NAME:
            return index.id
    logging.info("Creating TwelveLabs index %r", settings.PEGASUS_INDEX_NAME)
    created = client.indexes.create(
        index_name=settings.PEGASUS_INDEX_NAME,
        models=[
            {
                "model_name": settings.PEGASUS_MODEL,
                "model_options": ["visual", "audio"],
            }
        ],
    )
    return created.id


def transcribe_pegasus(
    queue: SubmissionQueue,
    media_path: Path,
    start_offset: float,
    progress_callback: ProgressCallbackType | None,
    lang_code: Optional[str] = "en",
):
    # Imported lazily so the default whisper backend works without the
    # twelvelabs SDK installed.
    from twelvelabs import TwelveLabs

    if not settings.TWELVELABS_API_KEY:
        raise ValueError(
            "TRANSCRIPTION_BACKEND=pegasus requires TWELVELABS_API_KEY to be set"
        )

    client = TwelveLabs(api_key=settings.TWELVELABS_API_KEY)
    index_id = _get_or_create_index(client)

    with tempfile.TemporaryDirectory() as tmp:
        video_path = _ensure_indexable_video(media_path, Path(tmp))

        logging.info("Indexing media into TwelveLabs for Pegasus transcription")
        with open(video_path, "rb") as f:
            task = client.tasks.create(index_id=index_id, video_file=f)
        if task.id is None:
            raise RuntimeError("TwelveLabs did not return an indexing task id")

        def _on_status(res):
            if progress_callback is not None:
                # Indexing dominates wall-clock; map it to the 0..0.8 range.
                progress_callback(progress=0.4, step=f"pegasus:index:{res.status}")

        done = client.tasks.wait_for_done(task_id=task.id, callback=_on_status)
        if done.status != "ready" or done.video_id is None:
            raise RuntimeError(
                f"TwelveLabs indexing did not complete (status={done.status})"
            )

    if progress_callback is not None:
        progress_callback(progress=0.8, step="pegasus:analyze")

    response = client.analyze(
        model_name=settings.PEGASUS_MODEL,
        video_id=done.video_id,
        prompt=_TRANSCRIBE_PROMPT,
        temperature=0.0,
        max_tokens=settings.PEGASUS_MAX_TOKENS,
    )

    paragraphs = parse_pegasus_segments(
        response.data or "", lang=lang_code or "en", start_offset=start_offset
    )
    for paragraph in paragraphs:
        queue.submit(paragraph)

    if progress_callback is not None:
        progress_callback(progress=1.0, step="pegasus:done")


def transcribe_pegasus_async(
    media_path: Path,
    start_offset: float,
    progress_callback: ProgressCallbackType | None,
    lang_code: Optional[str] = "en",
):
    return aiter(
        async_task(
            transcribe_pegasus,
            media_path=media_path,
            start_offset=start_offset,
            lang_code=lang_code,
            progress_callback=progress_callback,
        )
    )
