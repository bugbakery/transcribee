from sqlalchemy.sql.expression import desc
from sqlmodel import col, select
from transcribee_backend.admin_cli.command import Command
from transcribee_backend.db import SessionContextManager
from transcribee_backend.models.document import Document
from transcribee_backend.models.user import User


class ListDocumentsCmd(Command):
    def configure_parser(self, parser):
        pass

    def run(self, args):
        with SessionContextManager(path="management_command:list_documents") as session:
            statement = (
                select(
                    Document.created_at, Document.duration, Document.name, User.username
                )
                .order_by(desc(col(Document.changed_at)), col(Document.id))
                .join(Document.user)
            )
            result = session.exec(statement)
            for created, dur, name, username in result:
                if dur is None:
                    print(f"{created}          None {username: >20} {name}")
                else:
                    print(f"{created} {float(dur):10.2f} {username: >20} {name}")
