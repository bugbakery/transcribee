from django.urls import path

from channels.routing import ProtocolTypeRouter, URLRouter
from backend.sync import routing as sync_routing

websocket_urlpatterns = [
    path("sync/", URLRouter(sync_routing.websocket_urlpatterns)),
]
