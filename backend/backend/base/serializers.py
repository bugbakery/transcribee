from rest_framework import serializers
from .models import User, Document


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("username",)


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ("id", "name", "audio_file", "yjs_content", "created_at", "changed_at")
