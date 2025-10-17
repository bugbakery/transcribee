import hashlib
import hmac
import json
import os
import os.path
import secrets
import shutil
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from pathlib import Path
from typing import BinaryIO
from urllib import parse

import filetype
from fastapi import HTTPException, Query
from fastapi.params import Header
from fastapi.responses import FileResponse, Response

from .config import settings

SIGNATURE_PARAMETER = "X-Transcribee-Signature"
MEDIA_SIGNATURE_TYPE = "transcribee.media"


def b64_encode(s: bytes) -> bytes:
    return urlsafe_b64encode(s).strip(b"=")


def b64_decode(s: bytes) -> bytes:
    pad = b"=" * (-len(s) % 4)
    return urlsafe_b64decode(s + pad)


def store_file(file: BinaryIO) -> str:
    name = str(uuid.uuid4())
    outfile = os.path.join(settings.storage_path, name)
    with open(outfile, "wb") as f:
        file.seek(0)
        shutil.copyfileobj(file, f)
    return name


def force_bytes(v: bytes | str) -> bytes:
    if isinstance(v, str):
        return v.encode()
    return v


# Based on djangos django.utils.crypt.salted_hmac
def salted_hmac(
    key_salt: str | bytes, value: bytes, secret: str | bytes, *, algorithm="sha1"
) -> bytes:
    key_salt = force_bytes(key_salt)
    secret = force_bytes(secret)
    try:
        hasher = getattr(hashlib, algorithm)
    except AttributeError as e:
        raise ValueError(
            "%r is not an algorithm accepted by the hashlib module." % algorithm
        ) from e
    # Generate key from key_salt and secret
    key = hasher(key_salt + secret).digest()
    return hmac.new(key, msg=force_bytes(value), digestmod=hasher).digest()


def get_media_url(file: str) -> str:
    msg = {"file": file, "timestamp": int(time.time())}
    data = json.dumps(msg).encode()
    raw_signature = salted_hmac(
        key_salt=MEDIA_SIGNATURE_TYPE, secret=settings.secret_key, value=data
    )
    text_signature = b64_encode(raw_signature).decode()
    text_data = b64_encode(data).decode()
    signature = f"{text_data}:{text_signature}"
    return "{}media/{}?{}".format(
        settings.media_url_base, file, parse.urlencode({SIGNATURE_PARAMETER: signature})
    )


class BadSignature(Exception):
    pass


def unsign(user_sig: str, max_age: int) -> str:
    value, signature = user_sig.split(":", maxsplit=1)
    value = b64_decode(value.encode())
    value_dict = json.loads(value)
    if not isinstance(value_dict, dict):
        raise ValueError()
    signature = b64_decode(signature.encode())

    raw_signature = salted_hmac(
        key_salt=MEDIA_SIGNATURE_TYPE, secret=settings.secret_key, value=value
    )
    signature_valid = secrets.compare_digest(signature, raw_signature)
    if not signature_valid:
        raise BadSignature("Invalid signature")

    timestamp_age = int(value_dict["timestamp"])
    if timestamp_age < int(time.time()) - max_age:
        raise BadSignature("Signture expired")

    return value_dict["file"]


def verify_media_url(file: str, user_sig: str, max_age: int) -> bool:
    try:
        signed_file = unsign(user_sig, max_age)
    except Exception:
        raise HTTPException(status_code=403)

    if signed_file != file:
        raise HTTPException(status_code=403)

    return True


def is_safe_path(basedir: Path, path: Path):
    matchpath = path.absolute()
    basedir = basedir.absolute()
    return basedir == Path(os.path.commonpath((basedir, matchpath)))


# 512 KB seems to be not too small and makes the player start playing pretty quickly
# even on slow connections
MAX_CHUNK_SIZE = 512 * 1024


def serve_media(
    file: str, user_sig: str = Query(alias=SIGNATURE_PARAMETER), range=Header(None)
):
    verify_media_url(file, user_sig, settings.media_signature_max_age)
    path = settings.storage_path / file
    if not is_safe_path(settings.storage_path, path):  # Path traversal. Naughty!
        raise HTTPException(status_code=403)

    # handle chunked responses
    if range is not None:
        # would be nice to use FileResponse but it doesn't support range requests yet
        # see issue: https://github.com/encode/starlette/issues/950
        start, end = str(range).replace("bytes=", "").split("-")

        filesize = path.stat().st_size
        start = int(start)
        end = min(int(end), filesize - 1) if end else filesize - 1

        # prevent loading large files to server memory and prevent the player from
        # waiting for the entire file to download before starting to play
        end = min(int(end), start + MAX_CHUNK_SIZE)

        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(end - start + 1)
            headers = {
                "Content-Range": f"bytes {start}-{end}/{filesize}",
                "Accept-Ranges": "bytes",
            }

            return Response(
                data,
                status_code=206,
                headers=headers,
                media_type=filetype.guess_mime(path),
            )
    else:
        return FileResponse(path, media_type=filetype.guess_mime(path))
