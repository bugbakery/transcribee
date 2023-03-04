from rest_framework import serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.serializers import AuthTokenSerializer
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from transcribee_backend.base.models import Document, User
from transcribee_backend.base.serializers import DocumentSerializer, UserSerializer

from .serializers import CreateUserSerializer


class DocumentViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        return Document.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]


class UserViewSet(viewsets.ViewSet):
    serializer_class = CreateUserSerializer

    def create(self, request, *args, **kwargs):
        serializer = CreateUserSerializer(data=request.data)
        if serializer.is_valid():
            user, created = User.objects.get_or_create(
                username=serializer.validated_data["username"]
            )
            if not created:
                raise serializers.ValidationError(
                    {"username": "User with that name already exists"}
                )
            user.set_password(serializer.validated_data["password"])
            user.save()
            return Response({"username": user.username}, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def me(self, request):
        user = self.request.user
        return Response(UserSerializer(instance=user).data)

    @action(detail=False, methods=["post"])
    def login(self, request):
        serializer = AuthTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, created = Token.objects.get_or_create(user=user)
        return Response({"token": token.key})
