import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from transcribee_backend.base.models import Document, DocumentUpdate

from .enums import SyncMessageType


@database_sync_to_async
def get_doc(doc_id):
    return Document.objects.get(id=doc_id)


@database_sync_to_async
def create_update(document, update_content):
    return DocumentUpdate.objects.create(
        document=document, update_content=update_content
    )


@database_sync_to_async
def save_doc(document):
    document.save()


class DocumentSyncConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.document_id = self.scope["url_route"]["kwargs"]["document_id"]
        self.document = await get_doc(self.document_id)
        self.room_group_name = "sync_%s" % self.document_id

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.accept()

        async for update in DocumentUpdate.objects.filter(
            document=self.document
        ).aiterator():
            await self.send_change(change_content=update.update_content)
            if settings.TRANSCRIBEE_INITIAL_SYNC_SLOWDOWN is not None:
                await asyncio.sleep(settings.TRANSCRIBEE_INITIAL_SYNC_SLOWDOWN / 1000)

        await self.send_change_backlog_complete()

    async def send_change(self, change_content):
        msg = bytes([SyncMessageType.CHANGE]) + change_content
        await self.send(bytes_data=msg)

    async def send_change_backlog_complete(self):
        msg = bytes([SyncMessageType.CHANGE_BACKLOG_COMPLETE])
        await self.send(bytes_data=msg)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, bytes_data):
        await create_update(document=self.document, update_content=bytes_data)
        await save_doc(self.document)  # save document to update changed_at field

        # TODO: Do not send update back to user
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "broadcast_change", "change_content": bytes_data},
        )

    async def broadcast_change(self, msg):
        await self.send_change(msg["change_content"])
