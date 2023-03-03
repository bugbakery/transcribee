from fastapi import FastAPI, Depends
from .db import init_db, get_session
from .models import User
from sqlmodel import Session

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "🎤🐝: *taps mic* bzzp bzzp"}
