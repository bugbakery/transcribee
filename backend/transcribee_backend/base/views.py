from django.core.exceptions import PermissionDenied
from django.http import FileResponse
from django.views.static import serve

from .utils import verify_url


def serve_signed(request, *args, salt: str, max_age: int, **kwargs) -> FileResponse:
    path = request.get_full_path()
    if not verify_url(path, salt=salt, max_age=max_age):
        raise PermissionDenied()
    response = serve(request, *args, **kwargs)
    response["Access-Control-Allow-Origin"] = "*"
    return response
