import pytest
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


@pytest.fixture
def document(memory_session: Session, logged_in_client: TestClient):
    req = logged_in_client.post(
        "/api/v1/documents/", files={"file": b""}, data={"name": "test document"}
    )
    assert req.status_code == 200
    document_id = req.json()["id"]

    memory_session.add(DocumentUpdate(document_id=document_id, change_bytes=b""))
    memory_session.commit()

    yield document_id

    logged_in_client.delete(f"/api/v1/documents/{document_id}/")


def test_doc_delete(
    memory_session: Session, client: TestClient, logged_in_client: TestClient
):
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

    req = client.delete(f"/api/v1/documents/{document_id}/")
    assert 400 <= req.status_code < 500

    req = logged_in_client.delete(f"/api/v1/documents/{document_id}/")
    assert req.status_code == 200

    for table in checked_tables:
        assert counts[table] == memory_session.query(table).count()

    assert files == set(str(x) for x in settings.storage_path.glob("*"))


@pytest.mark.parametrize(
    "method,url,need_specific_user",
    [
        ["get", "/api/v1/documents/", False],
        ["get", "/api/v1/documents/{document_id}/", True],
        ["delete", "/api/v1/documents/{document_id}/", True],
        ["get", "/api/v1/documents/{document_id}/tasks/", True],
    ],
)
def test_user_auth(
    logged_in_client: TestClient,
    logged_in_client_user_2: TestClient,
    client: TestClient,
    document: str,
    method: str,
    url: str,
    need_specific_user: bool,
):
    # Try to access without auth
    req = getattr(client, method)(url.format(document_id=document))
    assert 400 <= req.status_code < 500

    # Try to access with different user
    req = getattr(logged_in_client_user_2, method)(url.format(document_id=document))
    if need_specific_user:
        assert 400 <= req.status_code < 500
    else:
        assert 200 <= req.status_code < 300

    # Try to access with owning user
    req = getattr(logged_in_client, method)(url.format(document_id=document))
    assert 200 <= req.status_code < 300
