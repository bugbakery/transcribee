import argparse
import asyncio
import json
import urllib.parse

import automerge
import inquirer
import requests
import websockets
from transcribee_proto.sync import SyncMessageType


def get_token(base_url: str, username: str, password: str):
    req = requests.post(
        f"{base_url}/api/v1/users/login/",
        json={"username": username, "password": password},
    )
    req.raise_for_status()
    return req.json()["token"]


def get_documents(base_url: str, token: str):
    req = requests.get(
        f"{base_url}/api/v1/documents",
        headers={"Authorization": f"Token {token}"},
    )
    req.raise_for_status()
    return req.json()


async def dump_doc(websocket_base_url: str, token: str, doc_id: str):
    doc = automerge.init({})
    params = urllib.parse.urlencode({"authorization": f"Token {token}"})
    async with websockets.connect(
        f"{websocket_base_url}/api/v1/documents/sync/{doc_id}/?{params}"
    ) as websocket:
        while True:
            msg = await websocket.recv()
            if msg[0] == SyncMessageType.CHANGE:
                automerge.apply_changes(doc, [msg[1:]])
            elif msg[0] == SyncMessageType.CHANGE_BACKLOG_COMPLETE:
                return doc
            elif msg[0] == SyncMessageType.FULL_DOCUMENT:
                doc = automerge.load(msg[1:])


def dump_doc_sync(websocket_base_url: str, token: str, doc_id: str):
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(dump_doc(websocket_base_url, token, doc_id))


def get_doc_metadata(base_url: str, token: str, doc_id: str):
    req = requests.get(
        f"{base_url}/api/v1/documents/{doc_id}",
        headers={"Authorization": f"Token {token}"},
    )
    req.raise_for_status()
    return req.json()


def get_doc_audio_bytes(doc_metadata):
    audio_url = doc_metadata["audio_file"]
    req = requests.get(audio_url)
    req.raise_for_status()
    return req.content


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--out")
    args = parser.parse_args()

    sync_url = urllib.parse.urlparse(args.base_url)
    assert sync_url.scheme in ["http", "https"]
    sync_url = sync_url._replace(scheme="ws" if sync_url.scheme == "http" else "wss")
    websocket_base_url = urllib.parse.urlunparse(sync_url) or ""

    answers = {"username": args.username, "password": args.password}

    questions = []
    if args.username is None:
        questions.append(inquirer.Text("username", message="What's your username"))
    if args.password is None:
        questions.append(inquirer.Password("password", message="What's your password"))

    if questions:
        answers.update(inquirer.prompt(questions) or {})

    token = get_token(
        args.base_url, username=answers["username"], password=answers["password"]
    )

    docs = get_documents(args.base_url, token)

    questions = [
        inquirer.List(
            "document",
            message="Select Document",
            choices=[(d["name"], d["id"]) for d in docs],
        ),
    ]
    answers = inquirer.prompt(questions) or {}

    doc_id = answers["document"]

    doc = dump_doc_sync(websocket_base_url, token, doc_id)
    doc = automerge.dump(doc)

    if args.out is not None:
        with open(args.out, "w") as f:
            json.dump(doc, f)
    else:
        print(json.dumps(doc))
