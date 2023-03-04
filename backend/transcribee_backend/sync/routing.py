from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(
        r"documents/(?P<document_id>[-a-z0-9]+)/$",
        consumers.DocumentSyncConsumer.as_asgi(),
    ),
]
