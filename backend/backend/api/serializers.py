from rest_framework import serializers
from backend.base.models import User


class CreateUserSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()
