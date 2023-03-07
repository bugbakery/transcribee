import datetime
from typing import Optional

from django.http import HttpResponse

from .models import Worker


class WorkerTokenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def _add_worker_to_request(self, request):
        request.authenticated_worker = None

        authorization_header: Optional[str] = request.headers.get("authorization")
        if authorization_header is None:
            return None

        if " " not in authorization_header:
            return None

        token_type, token = authorization_header.split(" ", maxsplit=1)
        if token_type != "Worker":
            return
        try:
            request.authenticated_worker = Worker.objects.get(token=token)
        except Worker.DoesNotExist:
            return HttpResponse(
                '{"details": "Incorrect authentication credentials."}',
                status=401,
                content_type="application/json",
            )

        request.authenticated_worker.last_seen = datetime.datetime.now()
        request.authenticated_worker.save(update_fields=["last_seen"])

    def __call__(self, request):
        auth_resp = self._add_worker_to_request(request)
        if auth_resp is not None:
            return auth_resp
        response = self.get_response(request)
        return response
