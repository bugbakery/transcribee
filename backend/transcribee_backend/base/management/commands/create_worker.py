from django.core.management.base import BaseCommand

from ...models import Worker


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--token", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args, **options):
        if not Worker.objects.filter(token=options["token"]).exists():
            Worker.objects.create(
                token=options["token"],
                name=options["name"],
            )
            self.stdout.write("Created worker")
        else:
            self.stdout.write("Worker with token already exists, not creating new one")
