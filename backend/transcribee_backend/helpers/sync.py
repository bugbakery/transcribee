import asyncio
from asyncio import Queue
from typing import Callable

from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session, select
from starlette.websockets import WebSocketState
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
    def __init__(self, document: Document, websocket: WebSocket, session: Session):
        self._doc = document
        self._ws = websocket
        self._session = session
        self._subscribed = set()
        self._msg_queue = Queue()

    def subscribe(self, channel: str):
        self._subscribed.add(channel)
        sync_manager.subscribe(channel, self.handle_incoming_broadcast)

    async def handle_incoming_broadcast(self, channel: str, message: bytes):
        if channel in self._subscribed:
            await self._msg_queue.put(message)

    async def listener(self):
        while True:
            await self.on_message(await self._ws.receive_bytes())

    async def broadcast_sender(self):
        statement = select(DocumentUpdate).where(DocumentUpdate.document == self._doc)
        for update in self._session.exec(statement):
            await self._ws.send_bytes(
                bytes([SyncMessageType.CHANGE]) + update.change_bytes
            )
        await self._ws.send_bytes(bytes([SyncMessageType.CHANGE_BACKLOG_COMPLETE]))
        while True:
            msg = await self._msg_queue.get()
            await self._ws.send_bytes(bytes([SyncMessageType.CHANGE]) + msg)

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

    async def disconnect(self):
        for ch in self._subscribed:
            sync_manager.unsubscribe(ch, self.handle_incoming_broadcast)
        if self._ws.client_state == WebSocketState.CONNECTED:
            await self._ws.close()

    async def on_broadcast(self, channel: str, message: bytes):
        if channel == str(self._doc.id):
            await self._ws.send_bytes(message)

    async def on_message(self, message: bytes):
        update = DocumentUpdate(change_bytes=message, document_id=self._doc.id)
        self._session.add(update)
        self._session.commit()
        await sync_manager.broadcast(str(self._doc.id), message)
