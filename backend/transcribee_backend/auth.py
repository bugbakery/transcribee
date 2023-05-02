import binascii
import datetime
import hashlib
import hmac
import os
from base64 import b64decode, b64encode
from typing import Optional, Tuple

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security.http import HTTPBase, HTTPBaseModel
from fastapi.security.utils import get_authorization_scheme_param
from sqlmodel import Session, select
from transcribee_backend.db import get_session
from transcribee_backend.exceptions import UserAlreadyExists
from transcribee_backend.models import User, UserToken, Worker


class NotAuthorized(Exception):
    pass


def pw_hash(pw: str) -> Tuple[bytes, bytes]:
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 500000)
    return salt, pw_hash


def pw_cmp(salt, hash, pw) -> bool:
    return hmac.compare_digest(
        hash, hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 500000)
    )


def generate_user_token(user: User):
    raw_token = b64encode(os.urandom(32)).decode()
    salt, hash = pw_hash(raw_token)
    token = b64encode(f"{user.username}:{raw_token}".encode()).decode()
    return token, UserToken(
        user_id=user.id,
        token_hash=hash,
        token_salt=salt,
        valid_until=datetime.datetime.now() + datetime.timedelta(days=7),
    )


def validate_user_authorization(session: Session, param: str):
    token_type, token = get_authorization_scheme_param(param)
    if token_type != "Token":
        raise HTTPException(status_code=401)

    try:
        token_data = b64decode(token.encode()).decode()
    except binascii.Error:
        raise HTTPException(status_code=400, detail="Invalid Token")

    if ":" not in token_data:
        raise HTTPException(status_code=400, detail="Invalid Token")
    username, provided_token = token_data.split(":", maxsplit=1)
    statement = select(UserToken).join(User).where(User.username == username)
    results = session.exec(statement)
    for token in results:
        if pw_cmp(salt=token.token_salt, hash=token.token_hash, pw=provided_token):
            return token

    raise HTTPException(status_code=401)


class TokenAuth(HTTPBase):
    def __init__(self):
        self.model = HTTPBaseModel(scheme="token")
        self.scheme_name = "Token"

    async def __call__(
        self, request: Request, session: Session = Depends(get_session)
    ) -> Optional[UserToken]:
        authorization = request.headers.get("Authorization")
        return validate_user_authorization(session, authorization)


get_user_token = TokenAuth()


def authorize_user(session: Session, username: str, password: str) -> User:
    statement = select(User).where(User.username == username)
    results = session.exec(statement)
    user = results.one_or_none()
    if user is None:
        raise NotAuthorized()
    if pw_cmp(
        salt=user.password_salt,
        hash=user.password_hash,
        pw=password,
    ):
        return user
    else:
        raise NotAuthorized()


def validate_worker_authorization(session: Session, authorization: str) -> Worker:
    if " " not in authorization:
        raise HTTPException(status_code=401)

    token_type, token = authorization.split(" ", maxsplit=1)
    if token_type != "Worker":
        raise HTTPException(status_code=401)

    statement = select(Worker).where(Worker.token == token)
    worker = session.exec(statement).one_or_none()
    if worker is None:
        raise HTTPException(status_code=401)
    return worker


def get_authorized_worker(
    authorization: str = Header(),
    session: Session = Depends(get_session),
):
    return validate_worker_authorization(session, authorization)


def create_user(session: Session, username: str, password: str) -> User:
    statement = select(User).where(User.username == username)
    results = session.exec(statement)
    existing_user = results.one_or_none()
    if existing_user is not None:
        raise UserAlreadyExists()
    salt, hash = pw_hash(password)
    user = User(username=username, password_hash=hash, password_salt=salt)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
