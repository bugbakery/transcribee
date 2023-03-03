from fastapi import FastAPI
from backend.routers.user import user_router

app = FastAPI()

app.include_router(user_router, prefix="/user")


@app.get("/")
async def root():
    return {"message": "🎤🐝: *taps mic* bzzp bzzp"}
