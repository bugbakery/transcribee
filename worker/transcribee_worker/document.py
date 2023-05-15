#!/usr/bin/env python3

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import automerge
import websockets
from transcribee_proto.document import Document as EditorDocument
from transcribee_proto.sync import SyncMessageType


class UnsupportedDocumentVersion(Exception):
    pass


class SyncedDocument:
    doc: automerge.Document
    conn: websockets.WebSocketClientProtocol

    @classmethod
    async def create(cls, connection):
        self = SyncedDocument()
        self.conn = connection
        self.doc = await self._get_document_state()
        await self._preprocess_doc()
        return self

    @asynccontextmanager
    async def transaction(self, message: str) -> AsyncGenerator:
        with automerge.transaction(self.doc, message) as d:
            yield d
        change = d.get_change()
        if change is not None:
            await self._send_change(change)

    async def _preprocess_doc(self):
        if self.doc.version is None:
            if automerge.dump(self.doc) == {}:
                async with self.transaction("Initialize Document") as d:
                    if d.children is None:
                        d.children = []
                    if d.speaker_names is None:
                        d.speaker_names = {}
                    d.version = 1
            else:
                raise UnsupportedDocumentVersion()

        if self.doc.version != 1:
            raise UnsupportedDocumentVersion()

    async def _get_document_state(self) -> automerge.Document:
        doc = automerge.init(EditorDocument)
        while True:
            msg = await self.conn.recv()
            if msg[0] == SyncMessageType.CHANGE:
                automerge.apply_changes(doc, [msg[1:]])
            elif msg[0] == SyncMessageType.CHANGE_BACKLOG_COMPLETE:
                break
            elif msg[0] == SyncMessageType.FULL_DOCUMENT:
                doc = automerge.load(msg[1:])

        return doc

    async def _send_change(self, change: automerge.Change):
        await self.conn.send(change.bytes())
