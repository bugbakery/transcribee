import asyncio

import automerge
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from django.core.paginator import Paginator
from transcribee_backend.base.models import Document, DocumentUpdate
from transcribee_proto.document import Document as EditorDocument
from transcribee_proto.sync import SyncMessageType


@database_sync_to_async
def get_doc(doc_id):
    return Document.objects.get(id=doc_id)


@database_sync_to_async
def create_update(document, update_content):
    return DocumentUpdate.objects.create(
        document=document, update_content=update_content
    )


@database_sync_to_async
def get_full_doc(document) -> bytes:
    changes = DocumentUpdate.objects.filter(document=document).values_list(
        "update_content", flat=True
    )
    doc = automerge.init(EditorDocument)
    for change_block in Paginator(changes, 100):
        automerge.apply_changes(doc, change_block)
    return doc


class DocumentSyncConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.document_id = self.scope["url_route"]["kwargs"]["document_id"]
        self.document = await get_doc(self.document_id)
        self.room_group_name = "sync_%s" % self.document_id

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.accept()

        self.automerge_doc = await get_full_doc(self.document)

        if settings.TRANSCRIBEE_INITIAL_SYNC_FULL_DOCUMENT:
            await self.send_full_doc(automerge.save(self.automerge_doc))
        else:
            async for update in DocumentUpdate.objects.filter(
                document=self.document
            ).aiterator():
                await self.send_change(change_content=update.update_content)
                if settings.TRANSCRIBEE_INITIAL_SYNC_SLOWDOWN is not None:
                    await asyncio.sleep(
                        settings.TRANSCRIBEE_INITIAL_SYNC_SLOWDOWN / 1000
                    )

        await self.send_change_backlog_complete()

    async def send_change(self, change_content: bytes):
        msg = bytes([SyncMessageType.CHANGE]) + change_content
        await self.send(bytes_data=msg)

    async def send_full_doc(self, doc_bytes: bytes):
        msg = bytes([SyncMessageType.FULL_DOCUMENT]) + doc_bytes
        await self.send(bytes_data=msg)

    async def send_change_backlog_complete(self):
        msg = bytes([SyncMessageType.CHANGE_BACKLOG_COMPLETE])
        await self.send(bytes_data=msg)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, bytes_data):
        await create_update(document=self.document, update_content=bytes_data)
        automerge.apply_changes(self.automerge_doc, [bytes_data])
        # save document to update changed_at field
        await database_sync_to_async(self.document.save)()

        # TODO: Do not send update back to user
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "broadcast_change", "change_content": bytes_data},
        )

    async def broadcast_change(self, msg):
        await self.send_change(msg["change_content"])
