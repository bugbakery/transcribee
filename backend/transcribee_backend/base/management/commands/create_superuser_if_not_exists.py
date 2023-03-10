from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--user", required=True)
        parser.add_argument("--pass", required=True)

    def handle(self, *args, **options):
        if not User.objects.filter(is_superuser=True).exists():
            User.objects.create_superuser(
                username=options["user"],
                password=options["pass"],
            )
            self.stdout.write("Created superuser")
        else:
            self.stdout.write("Superuser already exists, not creating new one")
