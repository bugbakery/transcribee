from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from transcribee_backend.auth import (
    NotAuthorized,
    authorize_user,
    create_user,
    generate_user_token,
    get_user_token,
)
from transcribee_backend.db import get_session
from transcribee_backend.exceptions import UserAlreadyExists
from transcribee_backend.models import CreateUser, User, UserBase, UserToken
from transcribee_proto.api import LoginResponse

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

    user_token, db_token = generate_user_token(authorized_user)
    session.add(db_token)
    session.commit()
    return LoginResponse(token=user_token)


@user_router.post("/logout/")
def logout(
    token: UserToken = Depends(get_user_token), session: Session = Depends(get_session)
) -> dict:
    session.delete(token)
    session.commit()

    return {"Delete": True}


@user_router.get("/me/")
def read_user(
    token: UserToken = Depends(get_user_token),
    session: Session = Depends(get_session),
):
    statement = select(User).where(User.id == token.user_id)
    user = session.exec(statement).one()
    return {"username": user.username}
