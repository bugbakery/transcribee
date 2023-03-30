import logging
import shutil
import tempfile
import urllib.parse
from io import BytesIO
from pathlib import Path
from typing import Optional

import automerge
import requests
import websockets
from pydantic import parse_raw_as
from transcribee_proto.api import AlignTask, AssignedTask, DiarizeTask
from transcribee_proto.api import Document as ApiDocument
from transcribee_proto.api import TaskType, TranscribeTask
from transcribee_proto.document import Document as EditorDocument
from transcribee_proto.sync import SyncMessageType
from transcribee_worker.diarize import diarize
from transcribee_worker.torchaudio_align import align
from transcribee_worker.util import load_audio
from transcribee_worker.whisper_transcribe import transcribe_clean


def ensure_timing_invariant(doc: EditorDocument):
    prev_atom = None
    for atom in doc.iter_atoms():
        if prev_atom is not None:
            assert prev_atom.start <= atom.start, f"{prev_atom} < {atom}"
        prev_atom = atom


class Worker:
    base_url: str
    token: str
    tmpdir: Optional[Path]
    task_types: list[TaskType]

    def __init__(
        self,
        base_url: str,
        websocket_base_url: str,
        token: str,
        task_types: Optional[list[TaskType]] = None,
    ):
        self.base_url = base_url
        self.websocket_base_url = websocket_base_url
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

    def get_document_audio_bytes(self, document: ApiDocument) -> Optional[bytes]:
        logging.debug(f"Getting audio. {document=}")
        if document.audio_file is None:
            return
        file_url = urllib.parse.urljoin(self.base_url, document.audio_file)
        response = requests.get(file_url)
        return response.content

    def get_document_audio(self, document: ApiDocument) -> Optional[BytesIO]:
        b = self.get_document_audio_bytes(document=document)
        if b is not None:
            return BytesIO(b)

    def get_document_audio_path(self, document: ApiDocument) -> Optional[Path]:
        b = self.get_document_audio_bytes(document=document)
        if b is not None:
            path = self._get_tmpfile("doc_audio")
            with open(path, "wb") as f:
                f.write(b)
            return path

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

    async def _init_doc(self, document_id: str, doc: automerge.Document):
        with automerge.transaction(doc, "Initialize Document") as d:
            if d.paragraphs is None:
                d.paragraphs = []
            if d.diarization is None:
                d.diarization = []
            if d.speaker_names is None:
                d.speaker_names = {}

        change = d.get_change()
        if change is not None:
            await self.send_change(document_id, change.bytes())

    async def get_document_state(self, document_id: str) -> automerge.Document:
        doc = automerge.init(EditorDocument)
        async with websockets.connect(
            f"{self.websocket_base_url}documents/{document_id}/"
        ) as websocket:
            while True:
                msg = await websocket.recv()
                if msg[0] == SyncMessageType.CHANGE_BACKLOG_COMPLETE:
                    break
                automerge.apply_changes(doc, [msg[1:]])

        await self._init_doc(document_id, doc)
        return doc

    async def send_change(self, document_id: str, change: bytes):
        async with websockets.connect(
            f"{self.websocket_base_url}documents/{document_id}/"
        ) as websocket:
            while True:
                msg_type, *_ = await websocket.recv()
                if msg_type == SyncMessageType.CHANGE_BACKLOG_COMPLETE:
                    break

            await websocket.send(change)

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

        doc = await self.get_document_state(task.document.id)

        with automerge.transaction(doc, "Reset Document") as d:
            d.paragraphs = []

        change = d.get_change()
        if change is not None:
            await self.send_change(task.document.id, change.bytes())

        async for paragraph in transcribe_clean(
            audio,
            task.task_parameters.model,
            task.task_parameters.lang,
            progress_callback,
        ):
            with automerge.transaction(doc, "Automatic Transcription") as d:
                d.paragraphs.append(paragraph.dict())

            change = d.get_change()
            if change is not None:
                await self.send_change(task.document.id, change.bytes())

    async def diarize(self, task: DiarizeTask):
        document_audio = self.get_document_audio_path(task.document)
        if document_audio is None:
            raise ValueError(
                f"Document {task.document} has no audio attached. Cannot diarize."
            )
        doc = await self.get_document_state(task.document.id)

        def progress_callback(_ctx, progress, _data):
            self.keepalive(task.id, progress=progress / 100)

        diarization = diarize(document_audio, progress_callback=progress_callback)
        with automerge.transaction(doc, "Diarization") as d:
            d.diarization = [x.dict() for x in diarization]
            d.speaker_names = {}

        change = d.get_change()
        if change is not None:
            await self.send_change(task.document.id, change.bytes())

    async def align(self, task: AlignTask):
        document_audio = self.get_document_audio(task.document)
        if document_audio is None:
            raise ValueError(
                f"Document {task.document} has no audio attached. Cannot align."
            )
        audio = load_audio(document_audio)
        doc = await self.get_document_state(task.document.id)
        document = EditorDocument.parse_obj(automerge.dump(doc))

        aligned_document = align(document, audio, extend_duration=500)
        ensure_timing_invariant(aligned_document)
        with automerge.transaction(doc, "Alignment") as d:
            for d_para, al_para in zip(d.paragraphs, aligned_document.paragraphs):
                for d_atom, al_atom in zip(d_para.children, al_para.children):
                    d_atom.start = al_atom.start
                    d_atom.end = al_atom.end

        change = d.get_change()
        if change is not None:
            await self.send_change(task.document.id, change.bytes())

        document = EditorDocument.parse_obj(automerge.dump(doc))

        if document.diarization:
            with automerge.transaction(doc, "Assign Speakers") as d:
                for para in d.paragraphs:
                    if len(para) == 0:
                        continue
                    para_start = para.children[0].start
                    para_end = para.children[-1].end
                    speakers = set(para.speakers)
                    for segment in document.diarization:
                        if segment.start <= para_end and segment.end >= para_start:
                            for speaker in segment.speakers:
                                speakers.add(speaker)

                    if set(para.speakers) != speakers:
                        para.speakers = sorted(list(speakers))

            change = d.get_change()
            if change is not None:
                await self.send_change(task.document.id, change.bytes())

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

    async def run_task(self, mark_completed=True):
        self.tmpdir = Path(tempfile.mkdtemp())
        task = self.claim_task()

        no_work = False

        try:
            if task is not None:
                task_result = await self.perform_task(task)
                logging.info(f"Worker returned: {task_result=}")
                if mark_completed:
                    self.mark_completed(task.id, {"result": task_result})
            else:
                logging.info("Got no task, not running worker")
                no_work = True
        except Exception as exc:
            logging.warning("Worker failed with exception", exc_info=exc)

        logging.debug(f"Cleaning tmpdir '{self.tmpdir}'")
        shutil.rmtree(self.tmpdir)
        self.tmpdir = None
        logging.debug("run_task() done :)")
        return no_work
