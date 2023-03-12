import datetime

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.serializers import AuthTokenSerializer
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from transcribee_backend.base.models import Document, Task, User
from transcribee_backend.base.serializers import (
    DocumentSerializer,
    TaskSerializer,
    UserSerializer,
)

from .serializers import KeepaliveSerializer, UserCreateSerializer


class DocumentViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        return Document.objects.filter(user=self.request.user).order_by("-changed_at")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]


class UserViewSet(viewsets.ViewSet):
    serializer_class = UserCreateSerializer

    def create(self, request, *args, **kwargs):
        serializer = UserCreateSerializer(data=request.data)
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


class IsAuthenticatedWorker:
    def has_permission(self, request, view):
        if request.authenticated_worker is None:
            return False

        return True


class TaskViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = TaskSerializer
    permission_classes = (IsAuthenticated,)

    def _get_lock_break_timestamp(self):
        return datetime.datetime.now() - datetime.timedelta(
            seconds=settings.TRANSCRIBEE_WORKER_TIMEOUT
        )

    def get_queryset(self):
        worker = self.request.authenticated_worker
        if worker is not None:
            return Task.objects.filter(
                assigned_worker=worker,
                last_keepalive__gte=self._get_lock_break_timestamp(),
            )
        if self.request.user.is_authenticated:
            return Task.objects.filter(document__user=self.request.user)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context.setdefault("document_queryset", Document.objects.none())
        if self.request.user.is_authenticated:
            context["document_queryset"] = Document.objects.filter(
                user=self.request.user
            )
        return context

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticatedWorker])
    def claim_unassigned_task(self, request):
        task_types = self.request.query_params.get("task_type", "").strip().split(",")

        filter_types = []
        for task_type in task_types:
            if task_type in Task.TaskType:
                filter_types.append(Task.TaskType[task_type])

        queryset = Task.objects.filter(task_type__in=filter_types)

        with transaction.atomic():
            queryset = queryset.filter(
                Q(assigned_worker__isnull=True)
                | Q(last_keepalive__lt=self._get_lock_break_timestamp())
            )
            job = queryset.select_for_update().first()
            if job is None:
                return HttpResponse("null", content_type="application/json")
            job.assigned_worker = request.authenticated_worker
            job.last_keepalive = datetime.datetime.now()
            job.save()
            serializer = self.get_serializer(job, many=False)
            return Response(serializer.data)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticatedWorker],
        serializer_class=KeepaliveSerializer,
    )
    def keepalive(self, request, pk):
        task = get_object_or_404(
            Task.objects.filter(assigned_worker=request.authenticated_worker), pk=pk
        )
        serializer = KeepaliveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if "progress" in serializer.validated_data:
            task.progress = serializer.validated_data["progress"]
        task.last_keepalive = datetime.datetime.now()
        task.save()
        serializer = self.get_serializer(task, many=False)
        return Response(serializer.data)
