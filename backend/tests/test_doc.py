from fastapi.testclient import TestClient
from sqlmodel import Session
from transcribee_backend.config import settings
from transcribee_backend.models import (
    Document,
    DocumentMediaFile,
    DocumentMediaTag,
    DocumentUpdate,
    Task,
    TaskDependency,
)


def test_doc_delete(memory_session: Session, logged_in_client: TestClient):
    checked_tables = [
        Task,
        TaskDependency,
        Document,
        DocumentMediaFile,
        DocumentMediaTag,
        DocumentUpdate,
    ]
    counts = {}
    for table in checked_tables:
        counts[table] = memory_session.query(table).count()

    files = set(str(x) for x in settings.storage_path.glob("*"))

    req = logged_in_client.post(
        "/api/v1/documents/", files={"file": b""}, data={"name": "test document"}
    )
    assert req.status_code == 200
    document_id = req.json()["id"]

    req = logged_in_client.get(f"/api/v1/documents/{document_id}/tasks/")
    assert req.status_code == 200
    assert len(req.json()) >= 1

    memory_session.add(DocumentUpdate(document_id=document_id, change_bytes=b""))
    memory_session.commit()

    for table in checked_tables:
        assert counts[table] < memory_session.query(table).count()

    assert files < set(str(x) for x in settings.storage_path.glob("*"))

    req = logged_in_client.delete(f"/api/v1/documents/{document_id}/")
    assert req.status_code == 200

    for table in checked_tables:
        assert counts[table] == memory_session.query(table).count()

    assert files == set(str(x) for x in settings.storage_path.glob("*"))
