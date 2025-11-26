import asyncio
from asyncio import Queue
from typing import Callable, Tuple
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session, select
from starlette.websockets import WebSocketState
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_proto.sync import SyncMessageType

from ..models import Document, DocumentUpdate


class DocumentSyncManager:
    def __init__(self):
        self.handlers: dict[str, set[Callable]] = {}

    async def broadcast(self, channel: str, message: bytes):
        for handler in self.handlers[channel]:
            await handler(channel, message)

    def subscribe(self, channel: str, handler: Callable):
        self.handlers.setdefault(channel, set())
        self.handlers[channel].add(handler)

    def unsubscribe(self, channel: str, handler):
        self.handlers.setdefault(channel, set())
        self.handlers[channel].remove(handler)


sync_manager = DocumentSyncManager()


class DocumentSyncConsumer:
    def __init__(
        self,
        document: Document,
        websocket: WebSocket,
        session: Session,
        can_write: bool,
    ):
        self._doc = document
        self._ws = websocket
        self._session = session
        self._can_write = can_write
        self._subscribed = set()
        self._msg_queue = Queue()
        self._id = uuid.uuid4()

    def subscribe(self, channel: str):
        self._subscribed.add(channel)
        sync_manager.subscribe(channel, self.handle_incoming_broadcast)

    async def handle_incoming_broadcast(self, channel: str, message: Tuple[uuid.UUID, bytes]):
        if channel in self._subscribed:
            id, msg = message
            if (id != self._id):
                await self._msg_queue.put(msg)

    async def listener(self):
        while True:
            await self.on_message(await self._ws.receive_bytes())

    async def broadcast_sender(self):
        statement = select(DocumentUpdate).where(DocumentUpdate.document == self._doc)

        # START:
        # Create a message as a list of bytes is hacky and only works for sure when using uvicorn
        # with the `websockets` module as the ws implementation.
        # `websockets` supports fragmenting the message into multiple frames, but you need to pass
        # the message as a list/iterator of bytes|str. Each item of this iterator is then sent as a
        # seperate frame.
        # This is a quick workaround to prevent uvicorn hanging for many seconds on larger documents
        #
        # The message given to `send_bytes` is passed through to the `send` function of the
        # websocket connection eventually. Since it is not touched on the way, we can pass a list of
        # bytes here instead of just bytes as would be allowed by the asgi spec:
        # https://asgi.readthedocs.io/en/latest/specs/www.html#send-send-event
        tag_change = bytes([SyncMessageType.CHANGE])
        for update in self._session.exec(statement):
            await self._ws.send_bytes(tag_change + len(update.change_bytes).to_bytes(4) + update.change_bytes)

        await self._ws.send_bytes(bytes([SyncMessageType.BACKLOG_COMPLETE]))

        while True:
            msg: bytes = await self._msg_queue.get()
            await self._ws.send_bytes(tag_change + len(msg).to_bytes(4) + msg)

    async def run(self):
        await self._ws.accept()
        self.subscribe(str(self._doc.id))
        pending = {
            asyncio.create_task(self.listener()),
            asyncio.create_task(self.broadcast_sender()),
        }
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for d in done:
                if d.exception() and isinstance(d.exception(), WebSocketDisconnect):
                    for task in pending:
                        task.cancel()
                    pending = set()

        await self.disconnect()

    async def disconnect(self, code=1000):
        for ch in self._subscribed:
            sync_manager.unsubscribe(ch, self.handle_incoming_broadcast)
        if self._ws.client_state == WebSocketState.CONNECTED:
            await self._ws.close(code=code)

    async def on_broadcast(self, channel: str, message: bytes):
        if channel == str(self._doc.id):
            await self._ws.send_bytes(message)

    async def on_message(self, message: bytes):
        if not self._can_write:
            await self.disconnect(code=1008)  # 1008 = POLICY VIOLATION
            return

        update = DocumentUpdate(change_bytes=message, document_id=self._doc.id)
        self._session.add(update)

        self._doc.changed_at = now_tz_aware()
        self._session.add(self._doc)

        self._session.commit()
        await sync_manager.broadcast(str(self._doc.id), (self._id, message))
