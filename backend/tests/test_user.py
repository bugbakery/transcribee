def test_me_endpoint_works(client, user, auth_token):
    req = client.get("/api/v1/users/me/")
    assert 400 <= req.status_code < 500

    req = client.get(
        "/api/v1/users/me/", headers={"Authorization": f"Token {auth_token}"}
    )
    assert req.status_code == 200
    assert req.json()["username"] == user.username


def test_me_endpoint_logged_in_client(logged_in_client, user):
    req = logged_in_client.get("/api/v1/users/me/")
    assert req.status_code == 200
    assert req.json()["username"] == user.username
