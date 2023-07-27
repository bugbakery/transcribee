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
    TaskAttempt,
    TaskDependency,
)


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
    memory_session.add(
        generate_share_token(
            document_id=document_id, name="Test Token", valid_until=None, can_write=True
        )
    )
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


@pytest.mark.parametrize("can_write", [True, False])
def test_doc_share(
    logged_in_client: TestClient,
    client: TestClient,
    document_id: str,
    can_write: bool,
):
    req = client.post(
        f"/api/v1/documents/{document_id}/share_tokens/",
        json={"name": "test token", "can_write": can_write},
    )
    assert 400 <= req.status_code < 500
    assert "share_token" not in req.json()

    req = logged_in_client.post(
        f"/api/v1/documents/{document_id}/share_tokens/",
        json={"name": "test token", "can_write": can_write},
    )
    assert req.status_code == 200
    assert "token" in req.json()
    token = req.json()["token"]

    req = client.get(f"/api/v1/documents/{document_id}/")
    assert 400 <= req.status_code < 500

    req = client.get(
        f"/api/v1/documents/{document_id}/", headers={"Share-Token": token}
    )
    assert req.status_code == 200
    assert not req.json()["has_full_access"]
    assert req.json()["can_write"] == can_write

    ref_req = logged_in_client.get(f"/api/v1/documents/{document_id}/")
    assert ref_req.status_code == 200
    assert ref_req.json()["has_full_access"]
    assert ref_req.json()["can_write"]

    req_json_without_auth = {
        k: v for k, v in req.json().items() if k not in ["has_full_access", "can_write"]
    }
    ref_req_json_without_auth = {
        k: v for k, v in req.json().items() if k not in ["has_full_access", "can_write"]
    }
    assert req_json_without_auth == ref_req_json_without_auth
