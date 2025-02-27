import uuid
from pathlib import Path

from sqlmodel import delete
from transcribee_backend.admin_cli.command import Command
from transcribee_backend.db import SessionContextManager
from transcribee_backend.models.document import DocumentUpdate


class SetDocumentCmd(Command):
    def configure_parser(self, parser):
        parser.add_argument(
            "--uuid", required=True, type=uuid.UUID, help="Document UUID"
        )
        parser.add_argument(
            "FILE", type=Path, help="File containing the binary automerge document"
        )

    def run(self, args):
        with SessionContextManager(path="management_command:set_document") as session:
            session.exec(
                delete(DocumentUpdate).where(DocumentUpdate.document_id == args.uuid)
            )
            update = DocumentUpdate(
                change_bytes=args.FILE.read_bytes(), document_id=args.uuid
            )
            session.add(update)
            session.commit()
