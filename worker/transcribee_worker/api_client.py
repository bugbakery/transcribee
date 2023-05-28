#!/usr/bin/env python3

import urllib.parse
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import requests
import websockets
from transcribee_worker.document import SyncedDocument


class ApiClient:
    def __init__(self, base_url: str, websocket_base_url: str, token: str):
        self.base_url = base_url
        self.websocket_base_url = websocket_base_url
        self.token = token

    def _get_headers(self):
        return {"authorization": f"Worker {self.token}"}

    def post(self, url, **kwargs):
        req = requests.post(
            self._get_url(url),
            **kwargs,
            headers=self._get_headers(),
        )
        req.raise_for_status()
        return req

    def _get_url(self, url):
        return urllib.parse.urljoin(self.base_url, url)

    def get(self, url):
        req = requests.get(self._get_url(url))
        req.raise_for_status()
        return req

    @asynccontextmanager
    async def document(self, id: str) -> AsyncGenerator[SyncedDocument, None]:
        params = urllib.parse.urlencode(self._get_headers())
        async with websockets.connect(
            f"{self.websocket_base_url}{id}/?{params}", max_size=None
        ) as websocket:
            doc = await SyncedDocument.create(websocket)
            try:
                yield doc
            finally:
                doc.stop()
