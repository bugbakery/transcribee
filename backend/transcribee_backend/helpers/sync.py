import asyncio
from asyncio import Queue
from typing import Callable
from collections import defaultdict
import logging

from fastapi import WebSocket
from sqlmodel import Session, select
from starlette.websockets import WebSocketState
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_proto.sync import SyncMessageType

from ..models import Document, DocumentUpdate


class DocumentSyncManager:
    def __init__(self):
        self.handlers: defaultdict[str, set[Callable]] = defaultdict(set)

    async def broadcast(self, channel: str, message: bytes | str):
        for handler in self.handlers[channel]:
            await handler(channel, message)

    def subscribe(self, channel: str, handler: Callable):
        self.handlers[channel].add(handler)

    def unsubscribe(self, channel: str, handler: Callable):
        self.handlers[channel].remove(handler)


sync_manager = DocumentSyncManager()


class DocumentSyncConsumer:
    def __init__(self, document: Document, websocket: WebSocket, session: Session):
        self._doc = document
        self._ws = websocket
        self._session = session
        self._subscribed = set()
        self._msg_queue_sync = Queue()
        self._msg_queue_presence = Queue()

    def subscribe(self, channel: str):
        self._subscribed.add(channel)
        sync_manager.subscribe(channel, self.handle_incoming_broadcast)

    async def handle_incoming_broadcast(self, channel: str, message: bytes | str):
        if channel in self._subscribed:
            if isinstance(message, bytes):
                await self._msg_queue_sync.put(message)
            else:
                await self._msg_queue_presence.put(message)

    async def listener(self):
        while True:
            message = await self._ws.receive()
            if "text" in message:
                await self.on_presence_message(message["text"])
            else:
                await self.on_sync_message(message["bytes"])

    async def broadcast_sender_sync(self):
        statement = select(DocumentUpdate).where(DocumentUpdate.document == self._doc)
        for update in self._session.exec(statement):
            await self._ws.send_bytes(
                bytes([SyncMessageType.CHANGE]) + update.change_bytes
            )
        await self._ws.send_bytes(bytes([SyncMessageType.CHANGE_BACKLOG_COMPLETE]))
        while True:
            msg = await self._msg_queue_sync.get()
            await self._ws.send_bytes(bytes([SyncMessageType.CHANGE]) + msg)

    async def broadcast_sender_presence(self):
        while True:
            msg = await self._msg_queue_presence.get()
            await self._ws.send_text(msg)

    async def run(self):
        await self._ws.accept()
        self.subscribe(str(self._doc.id))
        pending = {
            asyncio.create_task(self.listener()),
            # asyncio.create_task(self.listener_presence()),
            asyncio.create_task(self.broadcast_sender_sync()),
            asyncio.create_task(self.broadcast_sender_presence()),
        }
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for d in done:
                if d.exception():#  and isinstance(d.exception(), WebSocketDisconnect):
                    logging.error(f"exception: {d.exception()!r}")
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

    async def on_sync_message(self, message: bytes):
        update = DocumentUpdate(change_bytes=message, document_id=self._doc.id)
        self._session.add(update)

        self._doc.changed_at = now_tz_aware()
        self._session.add(self._doc)

        self._session.commit()
        await sync_manager.broadcast(str(self._doc.id), message)

    async def on_presence_message(self, message: str):
        await sync_manager.broadcast(str(self._doc.id), message)


# class PresenceManager:
#     def __init__(self):
#         self.connections: defaultdict[str, set[Callable]] = defaultdict(set)

#     async def broadcast(self, channel: str, message: bytes):
#         await asyncio.wait(
#             websocket.send_bytes(message) for websocket in self.connections[channel]
#         )

#     def subscribe(self, channel: str, websocket: WebSocket):
#         self.connections[channel].add(websocket)

#     def unsubscribe(self, channel: str, websocket: WebSocket):
#         self.connections[channel].remove(websocket)

# presence_manager = PresenceManager()
