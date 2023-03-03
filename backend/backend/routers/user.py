import binascii
import datetime
import hashlib
import hmac
import os
from base64 import b64decode, b64encode
from typing import Tuple

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import CreateUser, User, UserBase, UserToken


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


user_router = APIRouter()


@user_router.post("/create")
def create_user(user: CreateUser, session: Session = Depends(get_session)):
    statement = select(User).where(User.username == user.username)
    results = session.exec(statement)
    existing_user = results.one_or_none()
    if existing_user is not None:
        raise HTTPException(
            status_code=400, detail="A user with this username already exists."
        )
    salt, hash = pw_hash(user.password)
    user = User(username=user.username, password_hash=hash, password_salt=salt)
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserBase(username=user.username)


@user_router.post("/login")
def login(
    user: CreateUser, response: Response, session: Session = Depends(get_session)
):
    statement = select(User).where(User.username == user.username)
    results = session.exec(statement)
    existing_user = results.one_or_none()
    if existing_user is None:
        raise HTTPException(
            status_code=404, detail="A user with this name does not exist"
        )

    if pw_cmp(
        salt=existing_user.password_salt,
        hash=existing_user.password_hash,
        pw=user.password,
    ):
        user_token, db_token = generate_user_token(existing_user)
        session.add(db_token)
        session.commit()
        response.set_cookie(key="transcribee-backend-auth", value=user_token)
        return {"success": True}
    else:
        raise HTTPException(status_code=404, detail="Wrong password")


def get_user_token(
    token_cookie: str = Cookie(alias="transcribee-backend-auth"),
    session: Session = Depends(get_session),
):
    # TODO: Handle invalid cookies
    try:
        token_data = b64decode(token_cookie.encode()).decode()
    except binascii.Error:
        raise HTTPException(status_code=400, detail="Invalid Token")

    if not ":" in token_data:
        raise HTTPException(status_code=400, detail="Invalid Token")
    username, provided_token = token_data.split(":", maxsplit=1)
    statement = select(UserToken).join(User).where(User.username == username)
    results = session.exec(statement)
    for token in results:
        if pw_cmp(salt=token.token_salt, hash=token.token_hash, pw=provided_token):
            return token

    raise HTTPException(status_code=401)


@user_router.get("/me")
def read_user(
    token: UserToken = Depends(get_user_token),
    session: Session = Depends(get_session),
):
    statement = select(User).where(User.id == token.user_id)
    user = session.exec(statement).one()
    return {"username": user.username}
