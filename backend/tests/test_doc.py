import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from transcribee_backend.auth import generate_share_token
from transcribee_backend.config import settings
from transcribee_backend.models import (
    Document,
    DocumentMediaFile,
    DocumentMediaTag,
    DocumentShareToken,
    DocumentUpdate,
    Task,
    TaskDependency,
    User,
)
from transcribee_backend.models.task import TaskAttempt


@pytest.fixture
def document_id(memory_session: Session, logged_in_client: TestClient):
    req = logged_in_client.post(
        "/api/v1/documents/",
        files={"file": b""},
        data={"name": "test document", "model": "tiny", "language": "auto"},
    )
    assert req.status_code == 200
    document_id = req.json()["id"]

    memory_session.add(DocumentUpdate(document_id=document_id, change_bytes=b""))
    memory_session.commit()

    yield document_id

    logged_in_client.delete(f"/api/v1/documents/{document_id}/")


def test_doc_delete(
    memory_session: Session,
    client: TestClient,
    logged_in_client: TestClient,
    user: User,
):
    checked_tables = [
        Task,
        TaskDependency,
        TaskAttempt,
        Document,
        DocumentMediaFile,
        DocumentMediaTag,
        DocumentUpdate,
        DocumentShareToken,
    ]
    counts = {}
    for table in checked_tables:
        counts[table] = memory_session.query(table).count()

    files = set(str(x) for x in settings.storage_path.glob("*"))

    req = logged_in_client.post(
        "/api/v1/documents/",
        files={"file": b""},
        data={"name": "test document", "model": "tiny", "language": "auto"},
    )
    assert req.status_code == 200
    document_id = req.json()["id"]

    req = logged_in_client.get(f"/api/v1/documents/{document_id}/tasks/")
    assert req.status_code == 200
    assert len(req.json()) >= 1

    memory_session.add(DocumentUpdate(document_id=document_id, change_bytes=b""))
    memory_session.add(TaskAttempt(task_id=req.json()[0]["id"], attempt_number=1))
    _, token = generate_share_token(
        document_id=document_id, user_id=user.id, name="Test Token", valid_until=None
    )
    memory_session.add(token)
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
    document_id: str,
    method: str,
    url: str,
    need_specific_user: bool,
):
    # Try to access without auth
    req = getattr(client, method)(url.format(document_id=document_id))
    assert 400 <= req.status_code < 500

    # Try to access with different user
    req = getattr(logged_in_client_user_2, method)(url.format(document_id=document_id))
    if need_specific_user:
        assert 400 <= req.status_code < 500
    else:
        assert 200 <= req.status_code < 300

    # Try to access with owning user
    req = getattr(logged_in_client, method)(url.format(document_id=document_id))
    assert 200 <= req.status_code < 300


def test_doc_share(
    logged_in_client: TestClient, client: TestClient, user: User, document_id: str
):
    req = client.post(
        f"/api/v1/documents/{document_id}/share_tokens/", json={"name": "test token"}
    )
    assert 400 <= req.status_code < 500
    assert "share_token" not in req.json()

    req = logged_in_client.post(
        f"/api/v1/documents/{document_id}/share_tokens/", json={"name": "test token"}
    )
    assert req.status_code == 200
    assert "share_token" in req.json()
    token = req.json()["share_token"]

    req = client.get(f"/api/v1/documents/{document_id}/")
    assert 400 <= req.status_code < 500

    req = client.get(
        f"/api/v1/documents/{document_id}/", headers={"Authorization": "Share " + token}
    )
    assert req.status_code == 200

    ref_req = logged_in_client.get(f"/api/v1/documents/{document_id}/")
    assert ref_req.status_code == 200
    assert req.json() == ref_req.json()
