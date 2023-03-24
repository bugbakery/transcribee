import string
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.crypto import get_random_string
from django.utils.translation import gettext_lazy as _


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=255, null=False, blank=False)
    audio_file = models.FileField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    changed_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class DocumentUpdate(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE)
    update_content = models.BinaryField()


def generate_worker_token():
    return get_random_string(
        length=128, allowed_chars=string.ascii_lowercase + string.digits
    )


class Worker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=128, default=generate_worker_token)
    name = models.CharField(max_length=255, null=False, blank=False)

    last_seen = models.DateTimeField(blank=True, null=True)


class Task(models.Model):
    class TaskType(models.TextChoices):
        DIARIZE = "DIARIZE", _("Diarize")
        TRANSCRIBE = "TRANSCRIBE", _("Transcribe")
        ALIGN = "ALIGN", _("Align")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE)

    dependency = models.ManyToManyField(to="Task", blank=True)
    task_type = models.CharField(max_length=20, choices=TaskType.choices)
    progress = models.FloatField(null=True)
    task_parameters = models.JSONField(
        default=dict, help_text="Task parameters like language, number of speakers, ..."
    )

    assigned_at = models.DateTimeField(null=True)
    assigned_worker = models.ForeignKey(Worker, null=True, on_delete=models.SET_NULL)
    last_keepalive = models.DateTimeField(auto_now=True)

    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    completion_data = models.JSONField(default=dict)
