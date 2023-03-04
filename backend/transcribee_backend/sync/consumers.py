import json

from channels.generic.websocket import AsyncWebsocketConsumer
from transcribee_backend.base.models import Document, DocumentUpdate
from channels.db import database_sync_to_async


@database_sync_to_async
def get_doc(doc_id):
    return Document.objects.get(id=doc_id)


@database_sync_to_async
def get_doc_updates(doc):
    return list(DocumentUpdate.objects.filter(document=doc))


@database_sync_to_async
def create_update(document, update_content):
    return DocumentUpdate.objects.create(
        document=document, update_content=update_content
    )


class DocumentSyncConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.document_id = self.scope["url_route"]["kwargs"]["document_id"]
        self.document = await get_doc(self.document_id)
        self.room_group_name = "sync_%s" % self.document_id

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.accept()

        for update in await get_doc_updates(self.document):
            await self.send(bytes_data=update.update_content)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, bytes_data):
        await create_update(document=self.document, update_content=bytes_data)

        # TODO: Do not send update back to user
        await self.channel_layer.group_send(
            self.room_group_name, {"type": "channel_msg", "bytes_data": bytes_data}
        )

    async def channel_msg(self, message):
        await self.send(bytes_data=message["bytes_data"])
