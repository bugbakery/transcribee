from rest_framework import serializers
from transcribee_backend.base.models import Task
from transcribee_backend.base.serializers import DocumentSerializer


class UserCreateSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()


class KeepaliveSerializer(serializers.Serializer):
    progress = serializers.FloatField(required=False)


class AssignedTaskSerializer(serializers.ModelSerializer):
    document = DocumentSerializer(read_only=True)

    class Meta:
        model = Task
        fields = ("id", "task_type", "task_parameters", "document")


class TaskCompleteSerializer(serializers.Serializer):
    completion_data = serializers.JSONField()
