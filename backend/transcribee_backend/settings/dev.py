from .base import BASE_DIR, Base


class Dev(Base):
    SECRET_KEY = "django-insecure-bzzpbzzp"

    # Database
    # https://docs.djangoproject.com/en/4.1/ref/settings/#databases

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

    MEDIA_ROOT = BASE_DIR / "storage"
    MEDIA_URL = "/media/"

    DEBUG = True

    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
