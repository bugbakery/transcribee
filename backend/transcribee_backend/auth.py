import binascii
import datetime
import hashlib
import hmac
import os
import uuid
from base64 import b64decode, b64encode
from typing import Optional, Tuple

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import joinedload
from sqlmodel import Session, col, or_, select

from transcribee_backend.db import get_session
from transcribee_backend.exceptions import UserAlreadyExists, UserDoesNotExist
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models import (
    ApiToken,
    DocumentShareToken,
    Task,
    User,
    UserToken,
    Worker,
)


class NotAuthorized(Exception):
    pass


def pw_hash(pw: str, N=14) -> Tuple[bytes, bytes]:
    salt = os.urandom(16)
    pw_hash = hashlib.scrypt(pw.encode(), salt=salt, n=1 << N, r=8, p=1)
    return salt, pw_hash


def pw_cmp(salt, hash, pw, N=14) -> bool:
    return hmac.compare_digest(
        hash, hashlib.scrypt(pw.encode(), salt=salt, n=1 << N, r=8, p=1)
    )


def generate_user_token(user: User):
    raw_token = b64encode(os.urandom(32)).decode()
    salt, hash = pw_hash(
        raw_token, N=5
    )  # We can use a much lower N here since we do not need to protect against weak passwords
    token = b64encode(f"{user.id}:{raw_token}".encode()).decode()
    return token, UserToken(
        user_id=user.id,
        token_hash=hash,
        token_salt=salt,
        valid_until=now_tz_aware() + datetime.timedelta(days=7),
    )


def validate_user_authorization(session: Session, authorization: str):
    if " " not in authorization:
        raise HTTPException(status_code=401)

    token_type, token = authorization.split(" ", maxsplit=1)
    if token_type != "Token":
        raise HTTPException(status_code=401)

    try:
        token_data = b64decode(token).decode()
    except (UnicodeDecodeError, binascii.Error):
        raise HTTPException(status_code=400, detail="Invalid Token")

    if ":" not in token_data:
        raise HTTPException(status_code=400, detail="Invalid Token")
    user_id, provided_token = token_data.split(":", maxsplit=1)
    statement = select(UserToken).where(
        UserToken.user_id == user_id, UserToken.valid_until >= now_tz_aware()
    )
    results = session.exec(statement)
    for token in results:
        if pw_cmp(salt=token.token_salt, hash=token.token_hash, pw=provided_token, N=5):
            return token

    raise HTTPException(status_code=401)


def get_user_token(
    authorization: str = Header(),
    session: Session = Depends(get_session),
):
    return validate_user_authorization(session, authorization)


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

    statement = select(Worker).where(
        Worker.token == token, col(Worker.deactivated_at).is_(None)
    )
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
    return user


def change_user_password(session: Session, username: str, new_password: str) -> User:
    statement = select(User).where(User.username == username)
    results = session.exec(statement)
    existing_user = results.one_or_none()
    if existing_user is None:
        raise UserDoesNotExist()
    existing_user.password_salt, existing_user.password_hash = pw_hash(new_password)
    session.add(existing_user)
    session.commit()
    return existing_user


def get_authorized_task(
    task_id: uuid.UUID,
    session: Session = Depends(get_session),
    authorized_worker: Worker = Depends(get_authorized_worker),
):
    statement = (
        select(Task).where(Task.id == task_id).options(joinedload(Task.current_attempt))
    )
    task = session.exec(statement).one_or_none()
    if task is None:
        raise HTTPException(status_code=404)

    if (
        task.current_attempt is None
        or task.current_attempt.assigned_worker != authorized_worker
    ):
        raise HTTPException(status_code=403)

    return task


def generate_share_token(
    document_id: uuid.UUID,
    name: str,
    valid_until: Optional[datetime.datetime],
    can_write: bool,
):
    token = b64encode(os.urandom(32)).decode()
    return DocumentShareToken(
        document_id=document_id,
        token=token,
        valid_until=valid_until,
        name=name,
        can_write=can_write,
    )


def validate_share_authorization(
    session: Session, share_token: str, document_id: uuid.UUID
):
    statement = select(DocumentShareToken).where(
        DocumentShareToken.document_id == document_id,
        DocumentShareToken.token == share_token,
        or_(
            col(DocumentShareToken.valid_until).is_(None),
            col(DocumentShareToken.valid_until) >= now_tz_aware(),
        ),
    )
    token = session.exec(statement).one_or_none()
    if token:
        return token

    raise HTTPException(status_code=401)


def get_api_token(
    session: Session = Depends(get_session),
    api_token: str = Header(alias="Api-Token"),
) -> Optional[ApiToken]:
    return validate_api_token_authorization(session, api_token)


def validate_api_token_authorization(session: Session, api_token: str):
    statement = select(ApiToken).where(
        ApiToken.token == api_token,
    )
    token = session.exec(statement).one_or_none()
    if token:
        return token

    raise HTTPException(status_code=401)


def create_worker(session: Session, name: str) -> Worker:
    token = b64encode(os.urandom(32)).decode()
    worker = Worker(name=name, token=token, last_seen=None, deactivated_at=None)
    session.add(worker)
    session.commit()
    return worker


def create_api_token(session: Session, name: str) -> ApiToken:
    token = b64encode(os.urandom(64)).decode()
    token = ApiToken(name=name, token=token)
    session.add(token)
    session.commit()
    return token
