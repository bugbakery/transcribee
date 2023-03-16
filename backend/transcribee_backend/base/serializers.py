from django.conf import settings
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .models import Document, Task, User, Worker
from .utils import sign_url


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("username",)


class SignedFiledField(serializers.FileField):
    def to_representation(self, value):
        if not value:
            return None

        request = self.context["request"]
        url = sign_url(value.url, salt=settings.TRANSCRIBEE_MEDIA_SIGNATURE_SALT)
        return request.build_absolute_uri(url)


class DocumentSerializer(serializers.ModelSerializer):
    audio_file = SignedFiledField()

    class Meta:
        model = Document
        fields = ("id", "name", "audio_file", "created_at", "changed_at")
        ordering = ["-created_at", "id"]


class WorkerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Worker
        fields = ("id", "name")


class TaskSerializer(serializers.ModelSerializer):
    def __init__(self, *args, **kwargs):
        document_queryset = kwargs["context"].pop("document_queryset")
        super().__init__(*args, **kwargs)
        self.fields["document"].queryset = document_queryset

    class Meta:
        model = Task
        fields = (
            "id",
            "document",
            "task_type",
            "progress",
            "task_parameters",
            "assigned_worker",
            "last_keepalive",
            "assigned_at",
            "completed_at",
            "completion_data",
        )
        read_only_fields = (
            "assigned_worker",
            "last_keepalive",
            "progress",
            "assigned_at",
            "completed_at",
            "completion_data",
        )

    def validate_task_parameters(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValidationError("Must be a dict")
        return value
