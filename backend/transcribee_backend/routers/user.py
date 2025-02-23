import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, delete
from transcribee_proto.api import LoginResponse

from transcribee_backend.auth import (
    NotAuthorized,
    authorize_user,
    change_user_password,
    create_user,
    generate_user_token,
    get_user_token,
)
from transcribee_backend.db import get_session
from transcribee_backend.exceptions import UserAlreadyExists
from transcribee_backend.helpers.time import now_tz_aware
from transcribee_backend.models import CreateUser, UserBase, UserToken
from transcribee_backend.models.user import ChangePasswordRequest

user_router = APIRouter()


@user_router.post("/create/")
def create_user_req(user: CreateUser, session: Session = Depends(get_session)):
    try:
        db_user = create_user(
            session=session, username=user.username, password=user.password
        )
    except UserAlreadyExists:
        raise HTTPException(
            status_code=400, detail="A user with this username already exists."
        )
    return UserBase(username=db_user.username)


@user_router.post("/login/")
def login(user: CreateUser, session: Session = Depends(get_session)) -> LoginResponse:
    try:
        authorized_user = authorize_user(
            session=session, username=user.username, password=user.password
        )
    except NotAuthorized:
        raise HTTPException(403)

    user_token, db_token = generate_user_token(
        authorized_user, valid_until=now_tz_aware() + datetime.timedelta(days=7)
    )
    session.add(db_token)
    session.commit()
    return LoginResponse(token=user_token)


@user_router.post("/logout/")
def logout(
    token: UserToken = Depends(get_user_token), session: Session = Depends(get_session)
) -> None:
    session.delete(token)
    session.commit()


@user_router.get("/me/")
def read_user(
    token: UserToken = Depends(get_user_token),
) -> UserBase:
    return UserBase(username=token.user.username)


@user_router.post("/change_password/")
def change_password(
    body: ChangePasswordRequest,
    session: Session = Depends(get_session),
    token: UserToken = Depends(get_user_token),
) -> UserBase:
    try:
        authorized_user = authorize_user(
            session=session, username=token.user.username, password=body.old_password
        )
    except NotAuthorized:
        raise HTTPException(403)

    user = change_user_password(
        session=session,
        username=authorized_user.username,
        new_password=body.new_password,
    )
    session.exec(delete(UserToken).where(UserToken.user_id == authorized_user.id))
    session.commit()
    return UserBase(username=user.username)
