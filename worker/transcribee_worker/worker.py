import logging
import shutil
import tempfile
import urllib.parse
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests
from pydantic import parse_raw_as
from transcribee_proto.api import AlignTask, AssignedTask, DiarizeTask
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import TaskType, TranscribeTask
from transcribee_worker.util import load_audio
from transcribee_worker.whisper_transcribe import transcribe


class Worker:
    base_url: str
    token: str
    tmpdir: Optional[Path]
    task_types: list[TaskType]

    def __init__(
        self,
        base_url: str,
        token: str,
        task_types: Optional[list[TaskType]] = None,
    ):
        self.base_url = base_url
        self.token = token
        self.tmpdir = None
        if task_types is not None:
            self.task_types = task_types
        else:
            self.task_types = [TaskType.DIARIZE, TaskType.ALIGN, TaskType.TRANSCRIBE]

    def _get_headers(self):
        return {"Authorization": f"Worker {self.token}"}

    def claim_task(self) -> Optional[AssignedTask]:
        logging.info("Asking backend for new task")
        req = requests.post(
            f"{self.base_url}/claim_unassigned_task/",
            params={"task_type": ",".join(self.task_types)},
            headers=self._get_headers(),
        )
        req.raise_for_status()
        return parse_raw_as(Optional[AssignedTask], req.text)

    def _get_tmpfile(self, filename: str) -> Path:
        if self.tmpdir is None:
            raise ValueError("`tmpdir` must be set")
        return self.tmpdir / filename

    def get_document_audio(self, document: ApiDocument) -> Optional[BytesIO]:
        logging.debug(f"Getting audio. {document=}")
        if document.audio_file is None:
            return
        file_url = urllib.parse.urljoin(self.base_url, document.audio_file)
        response = requests.get(file_url)
        return BytesIO(response.content)

    def keepalive(self, task_id: str, progress: Optional[float]):
        body = {}
        if progress is not None:
            body["progress"] = progress
        logging.debug(f"Sending keepalive for {task_id=}: {body=}")
        req = requests.post(
            f"{self.base_url}/{task_id}/keepalive/",
            json=body,
            headers=self._get_headers(),
        )
        req.raise_for_status()

    async def perform_task(self, task: AssignedTask):
        logging.info(f"Running task: {task=}")

        if task.task_type == TaskType.DIARIZE:
            await self.diarize(task)
        elif task.task_type == TaskType.TRANSCRIBE:
            await self.transcribe(task)
        elif task.task_type == TaskType.ALIGN:
            await self.align(task)
        else:
            raise ValueError(f"Invalid task type: '{task.task_type}'")

    async def transcribe(self, task: TranscribeTask):
        if task.task_type != TaskType.TRANSCRIBE:
            return

        document_audio = self.get_document_audio(task.document)
        if document_audio is None:
            raise ValueError(
                f"Document {task.document} has no audio attached. Cannot transcribe."
            )
        audio = load_audio(document_audio)

        def progress_callback(_ctx, progress, _data):
            self.keepalive(task.id, progress=progress / 100)

        paragraphs = []
        async for paragraph in transcribe(
            audio,
            task.task_parameters.model,
            task.task_parameters.lang,
            progress_callback,
        ):
            paragraphs.append(paragraph)

        raise NotImplementedError("Transcription is not fully implemented yet")

    async def diarize(self, task: DiarizeTask):
        raise NotImplementedError("Diarization is not yet implemented")

    async def align(self, task: AlignTask):
        # document = Document(lang=args.lang, paragraphs=paragraphs)
        # aligned_document = align(document, audio)
        raise NotImplementedError("Alignment is not yet implemented")

    def mark_completed(self, task_id: str, completion_data: Optional[dict] = None):
        body = {
            "completion_data": completion_data if completion_data is not None else {}
        }
        logging.debug(f"Marking task as completed {task_id=} {body=}")
        req = requests.post(
            f"{self.base_url}/{task_id}/mark_completed/",
            json=body,
            headers=self._get_headers(),
        )
        req.raise_for_status()

    async def run_task(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        task = self.claim_task()

        no_work = False

        try:
            if task is not None:
                task_result = await self.perform_task(task)
                logging.info(f"Worker returned: {task_result=}")
                self.mark_completed(task.id, {"result": task_result})
            else:
                logging.info("Got empty task, not running worker")
                no_work = True
        except Exception as exc:
            logging.warning("Worker failed with exception", exc_info=exc)

        logging.debug(f"Cleaning tmpdir '{self.tmpdir}'")
        shutil.rmtree(self.tmpdir)
        self.tmpdir = None
        logging.info("Done :)")
        return no_work
