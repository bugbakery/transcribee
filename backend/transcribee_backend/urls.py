"""backend URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import re
from typing import Callable, Union

from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, include, path, re_path
from django.views.static import serve
from transcribee_backend.api import urls as backend_urls
from transcribee_backend.base.views import serve_signed

URL = Union[URLPattern, URLResolver]


def static_pattern(prefix, view: Callable = serve, **kwargs):
    return re_path(
        r"^%s(?P<path>.*)$" % re.escape(prefix.lstrip("/")), view, kwargs=kwargs
    )


urlpatterns: list[URL] = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(backend_urls)),
    path("auth/", include("django.contrib.auth.urls")),
    static_pattern(
        prefix=settings.MEDIA_URL,
        view=serve_signed,
        document_root=settings.MEDIA_ROOT,
        max_age=settings.TRANSCRIBEE_MEDIA_SIGNATURE_MAX_AGE_SECONDS,
        salt=settings.TRANSCRIBEE_MEDIA_SIGNATURE_SALT,
    ),
]


if settings.SELF_SERVE_STATIC:
    urlpatterns.append(
        static_pattern(prefix=settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    )
