import asyncio
import logging
import mimetypes
import tempfile
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Optional, Tuple

import automerge
import ffmpeg
import numpy.typing as npt
from pydantic import parse_raw_as
from transcribee_proto.api import (
    AlignTask,
    AssignedTask,
    ExportFormat,
    ExportTask,
    ReencodeTask,
    SpeakerIdentificationTask,
    TaskType,
    TranscribeTask,
)
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.document import Document as EditorDocument
from transcribee_worker.api_client import ApiClient
from transcribee_worker.config import settings
from transcribee_worker.identify_speakers import identify_speakers
from transcribee_worker.reencode import get_duration, reencode
from transcribee_worker.torchaudio_align import align
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import aenumerate, load_audio
from transcribee_worker.webvtt.export_webvtt import generate_web_vtt
from transcribee_worker.webvtt.webvtt_writer import SubtitleFormat
from transcribee_worker.whisper_transcribe import (
    transcribe_clean_async,
)


def normalize_for_automerge(value):
    def normalize_value(k, v):
        if isinstance(v, int):
            value[k] = float(v)
        if isinstance(v, str):
            value[k] = automerge.Text(v)
        else:
            normalize_for_automerge(v)

    if isinstance(value, dict):
        for k, v in value.items():
            normalize_value(k, v)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            normalize_value(i, item)


def ensure_atom_invariants(doc: EditorDocument):
    prev_atom = None
    for atom in doc.iter_atoms():
        if prev_atom is not None:
            assert prev_atom.start <= atom.start, f"{prev_atom} < {atom}"
        assert (atom.start is None and atom.end is None) or (
            atom.start is not None and atom.end is not None
        )
        if atom.start:
            assert atom.start <= atom.end

        prev_atom = atom


def get_last_atom_end(doc: EditorDocument):
    for paragraph_idx in reversed(range(len(doc.children))):
        for atom_idx in reversed(range(len(doc.children[paragraph_idx].children))):
            atom = doc.children[paragraph_idx].children[atom_idx]
            if atom.end is not None:
                return atom.end

    return 0


def media_has_video(path: Path):
    streams = ffmpeg.probe(path)["streams"]
    for stream in streams:
        if stream["codec_type"] == "video":
            if stream["disposition"]["attached_pic"] != 0:
                # ignore album covers
                continue

            return True

    return False


def is_video_profile(profile_name: str):
    return profile_name.startswith("video:")


class Worker:
    base_url: str
    token: str
    tmpdir: Optional[Path]
    task_types: list[TaskType]
    progress: Optional[float]

    def __init__(
        self,
        base_url: str,
        websocket_base_url: str,
        token: str,
        task_types: Optional[list[TaskType]] = None,
    ):
        self.api_client = ApiClient(base_url, websocket_base_url, token)
        self.tmpdir = None
        if task_types is not None:
            self.task_types = task_types
        else:
            self.task_types = [
                TaskType.IDENTIFY_SPEAKERS,
                TaskType.ALIGN,
                TaskType.TRANSCRIBE,
                TaskType.REENCODE,
                TaskType.EXPORT,
            ]

    def claim_task(self) -> Optional[AssignedTask]:
        logging.info("Asking backend for new task")
        req = self.api_client.post(
            "tasks/claim_unassigned_task/", params={"task_type": self.task_types}
        )

        return parse_raw_as(Optional[AssignedTask], req.text)  # type: ignore

    def _get_tmpfile(self, filename: str) -> Path:
        if self.tmpdir is None:
            raise ValueError("`tmpdir` must be set")
        return self.tmpdir / filename

    def get_document_audio_bytes(
        self, document: ApiDocument
    ) -> Optional[Tuple[bytes, str]]:
        logging.debug(f"Getting audio. {document=}")
        if not document.media_files:
            return
        media_file = document.media_files[0]
        for mf in document.media_files:
            if "profile:mp3" in mf.tags:
                media_file = mf
                break
        response = self.api_client.get(media_file.url)
        return response.content, media_file.content_type

    def get_document_audio_path(self, document: ApiDocument) -> Optional[Path]:
        b = self.get_document_audio_bytes(document=document)
        if b is not None:
            b, ct = b
            extension = mimetypes.guess_extension(ct)
            path = self._get_tmpfile(f"doc_audio{extension}")
            with open(path, "wb") as f:
                f.write(b)
            return path

    def load_document_audio(self, document: ApiDocument) -> npt.NDArray:
        document_audio = self.get_document_audio_path(document)
        if document_audio is None:
            raise ValueError(f"Document {document} has no audio attached.")
        return load_audio(document_audio)[0]

    def keepalive(self, task_id: str, progress: Optional[float]):
        body = {}
        if progress is not None:
            body["progress"] = progress
        logging.debug(f"Sending keepalive for {task_id=}: {body=}")
        self.api_client.post(f"tasks/{task_id}/keepalive/", json=body)

    async def perform_task(self, task: AssignedTask):
        logging.info(f"Running task: {task=}")

        def progress_callback(*, progress, step: Optional[str] = "", extra_data=None):
            step = f"{task.task_type}:{step}"
            self._set_progress(task.id, step, progress=progress, extra_data=extra_data)

        progress_callback(progress=0)
        if task.task_type == TaskType.IDENTIFY_SPEAKERS:
            await self.identify_speakers(task, progress_callback)
        elif task.task_type == TaskType.TRANSCRIBE:
            await self.transcribe(task, progress_callback)
        elif task.task_type == TaskType.ALIGN:
            await self.align(task, progress_callback)
        elif task.task_type == TaskType.REENCODE:
            await self.reencode(task, progress_callback)
        elif task.task_type == TaskType.EXPORT:
            await self.export(task, progress_callback)
        else:
            raise ValueError(f"Invalid task type: '{task.task_type}'")

        progress_callback(progress=1)

    async def transcribe(
        self, task: TranscribeTask, progress_callback: ProgressCallbackType
    ):
        audio = self.load_document_audio(task.document)

        async with self.api_client.document(task.document.id) as doc:
            async with doc.transaction("Reset Document") as d:
                if d.children is None:
                    d.children = []

                start_offset = get_last_atom_end(d)

            audio = audio[int(start_offset * settings.SAMPLE_RATE) :]

            async for paragraph in transcribe_clean_async(
                data=audio,
                sr=settings.SAMPLE_RATE,
                start_offset=start_offset,
                model_name=task.task_parameters.model,
                lang_code=(
                    task.task_parameters.lang
                    if task.task_parameters.lang != "auto"
                    else None
                ),
                progress_callback=progress_callback,
            ):
                async with doc.transaction("Automatic Transcription") as d:
                    p = paragraph.dict()
                    normalize_for_automerge(p)
                    d.children.append(p)

    async def identify_speakers(
        self, task: SpeakerIdentificationTask, progress_callback: ProgressCallbackType
    ):
        audio = self.load_document_audio(task.document)
        assert (
            task.task_parameters.number_of_speakers != 0
        )  # this would not make any sense
        assert (
            task.task_parameters.number_of_speakers != 1
        )  # this also would not make any sense

        async with self.api_client.document(task.document.id) as doc:
            async with doc.transaction("Speaker Identification") as d:
                await identify_speakers(
                    task.task_parameters.number_of_speakers, audio, d, progress_callback
                )

    async def align(self, task: AlignTask, progress_callback: ProgressCallbackType):
        audio = self.load_document_audio(task.document)

        async with self.api_client.document(task.document.id) as doc:
            # TODO(robin): #perf: avoid this copy
            document = EditorDocument.parse_obj(automerge.dump(doc.doc))

            aligned_para_iter = aiter(
                align(
                    document,
                    audio,
                    progress_callback,
                    # TODO(robin): this seems like a weird place to hardcode this parameter
                    extend_duration=0.5,
                )
            )
            async for i, al_para in aenumerate(aligned_para_iter):
                async with doc.transaction("Alignment") as d:
                    d_para = d.children[i]
                    for d_atom, al_atom in zip(d_para.children, al_para.children):
                        d_atom.start = al_atom.start
                        d_atom.end = al_atom.end

    async def reencode(
        self, task: ReencodeTask, progress_callback: ProgressCallbackType
    ):
        document_audio = self.get_document_audio_path(task.document)
        if document_audio is None:
            raise ValueError(
                f"Document {task.document} has no audio attached. Cannot reencode."
            )

        duration = get_duration(document_audio)
        self.set_duration(task, duration)

        has_video = media_has_video(document_audio)
        applicable_profiles = {
            profile_name: parameters
            for profile_name, parameters in settings.REENCODE_PROFILES.items()
            if has_video or not is_video_profile(profile_name)
        }
        n_profiles = len(applicable_profiles)

        for i, (profile, parameters) in enumerate(applicable_profiles.items()):
            output_path = self._get_tmpfile(f"reencode_{profile.replace(':', '_')}")
            video_profile = is_video_profile(profile)

            await reencode(
                document_audio,
                output_path,
                parameters,
                lambda progress, **kwargs: progress_callback(
                    progress=(i + progress) / n_profiles,
                    step=f"reencode_{profile}",
                    **kwargs,
                ),
                duration,
                include_video=video_profile,
            )

            tags = [f"profile:{profile}"] + [f"{k}:{v}" for k, v in parameters.items()]

            if video_profile:
                tags.append("video")

            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None, self.add_document_media_file, task, output_path, tags
            )

    async def export(self, task: ExportTask, progress_callback: ProgressCallbackType):
        async with self.api_client.document(task.document.id) as doc:
            params = task.task_parameters
            res = None
            try:
                vtt = generate_web_vtt(
                    EditorDocument.parse_obj(automerge.dump(doc.doc)),
                    params.include_speaker_names,
                    params.include_word_timing,
                    params.max_line_length,
                )

                if params.format == ExportFormat.VTT:
                    res = vtt.to_string(SubtitleFormat.VTT)
                elif params.format == ExportFormat.SRT:
                    res = vtt.to_string(SubtitleFormat.SRT)

                res = {"result": res}
            except ValueError as e:
                res = {"error": str(e)}

            if res is not None:
                logging.info(
                    f"Uploading document export for {task.document.id=} {res=}"
                )
                self.api_client.post(
                    f"documents/{task.document.id}/add_export_result/?task_id={task.id}",
                    json=res,
                )

    def set_duration(self, task: AssignedTask, duration: float):
        logging.debug(
            f"Setting audio duration for document {task.document.id=} {duration=}"
        )
        self.api_client.post(
            f"documents/{task.document.id}/set_duration/", json={"duration": duration}
        )

    def add_document_media_file(self, task: AssignedTask, path: Path, tags: list[str]):
        logging.debug(f"Replacing document audio for document {task.document.id=}")
        self.api_client.post(
            f"documents/{task.document.id}/add_media_file/",
            files={"file": open(path, "rb")},
            data=[("tags", tag) for tag in tags],
        )

    def mark_completed(self, task_id: str, additional_data: Optional[dict] = None):
        extra_data = {**self._result_data}
        if additional_data:
            extra_data.update(additional_data)
        body = {"extra_data": extra_data if extra_data is not None else {}}
        logging.debug(f"Marking task as completed {task_id=} {body=}")
        self.api_client.post(f"tasks/{task_id}/mark_completed/", json=body)

    def mark_failed(self, task_id: str, additional_data: Optional[dict] = None):
        extra_data = {**self._result_data}
        if additional_data:
            extra_data.update(additional_data)
        body = {"extra_data": extra_data if extra_data is not None else {}}
        logging.debug(f"Marking task as completed {task_id=} {body=}")
        self.api_client.post(f"tasks/{task_id}/mark_failed/", json=body)

    def _set_progress(
        self, task_id: str, step: str, progress: Optional[float], extra_data: Any = None
    ):
        self._result_data["progress"].append(
            {
                "step": step,
                "progress": progress,
                "extra_data": extra_data,
                "timestamp": time.time(),
            }
        )
        self.progress = progress

    @asynccontextmanager
    async def keepalive_task(
        self, task_id: str, seconds: float
    ) -> AsyncGenerator[None, None]:
        stop_event = asyncio.Event()

        async def _work():
            while not stop_event.is_set():
                try:
                    self.keepalive(task_id, self.progress)
                except Exception as exc:
                    logging.error("Keepliave failed", exc_info=exc)
                finally:
                    await asyncio.sleep(seconds)

        task = asyncio.create_task(_work())

        try:
            yield
        finally:
            stop_event.set()
            await task

    async def run_task(self, mark_completed=True):
        task = self.claim_task()
        no_work = False
        self._result_data = {"progress": []}

        if task is not None:
            try:
                self.progress = None
                with tempfile.TemporaryDirectory() as tmpdir:
                    async with self.keepalive_task(
                        task.id, settings.KEEPALIVE_INTERVAL
                    ):
                        self.tmpdir = Path(tmpdir)
                        task_result = await self.perform_task(task)
                        logging.info(f"Worker returned: {task_result=}")
                        if mark_completed:
                            self.mark_completed(task.id, {"result": task_result})
                self.tmpdir = None
            except Exception as exc:
                logging.warning("Worker failed with exception", exc_info=exc)
                self.mark_failed(
                    task.id, {"exception": traceback.format_exception(exc)}
                )
        else:
            logging.info("Got no task, not running worker")
            no_work = True

        logging.debug("run_task() done :)")
        return no_work
