from rest_framework import serializers


class UserCreateSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()


class KeepaliveSerializer(serializers.Serializer):
    progress = serializers.FloatField(required=False)
