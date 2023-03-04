from rest_framework import serializers
from transcribee_backend.base.models import User


class CreateUserSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()
