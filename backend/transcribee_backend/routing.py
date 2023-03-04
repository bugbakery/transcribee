from channels.routing import URLRouter
from django.urls import path
from transcribee_backend.sync import routing as sync_routing

websocket_urlpatterns = [
    path("sync/", URLRouter(sync_routing.websocket_urlpatterns)),
]
