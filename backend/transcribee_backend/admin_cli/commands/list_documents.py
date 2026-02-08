from sqlalchemy.sql.expression import desc
from sqlmodel import select
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
                .order_by(desc(Document.changed_at), Document.id)
                .join(Document.user)
            )
            result = session.exec(statement)
            format = "{} {:10.2f} {: >20} {}"
            for created, dur, name, username in result:
                print(format.format(created, float(dur), username, name))
