import timeit
from typing import Callable

import pytest
from fastapi.testclient import TestClient


def create_doc(logged_in_client: TestClient):
    req = logged_in_client.post(
        "/api/v1/documents/", files={"file": b""}, data={"name": "test document"}
    )
    assert req.status_code == 200


def user_me(logged_in_client: TestClient):
    req = logged_in_client.get("/api/v1/users/me/")
    assert req.status_code == 200


def document_list(logged_in_client: TestClient):
    req = logged_in_client.get("/api/v1/documents/")
    assert req.status_code == 200
    assert len(req.json()) >= 1


@pytest.mark.parametrize(
    "test_function,setup_function,N,max_time",
    [
        (create_doc, None, 50, 0.01),
        (user_me, None, 50, 0.005),
        (document_list, create_doc, 50, 0.01),
    ],
)
def test_execution_speed(
    test_function: Callable,
    setup_function: Callable,
    logged_in_client: TestClient,
    N: int,
    max_time: float,
):
    if setup_function is not None:
        setup_function(logged_in_client)
    time = timeit.timeit(
        lambda: test_function(logged_in_client=logged_in_client), number=N
    )
    assert time / N <= max_time
