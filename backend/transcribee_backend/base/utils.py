import logging
from datetime import timedelta
from urllib import parse

from django.core.signing import BadSignature, TimestampSigner

SIGNATURE_PARAMETER = "X-Transcribee-Signature"


def get_signer(salt: str) -> TimestampSigner:
    return TimestampSigner(salt=salt)


def sign_url(url: str, salt: str) -> str:
    signer = get_signer(salt=salt)
    full_signature = signer.sign(url)
    signature = full_signature.split(signer.sep, maxsplit=1)[1]

    logging.warning(f"Signed {salt=} {url=} {full_signature=}")
    return "{}?{}".format(url, parse.urlencode({SIGNATURE_PARAMETER: signature}))


def verify_url(url, salt: str, max_age: int | timedelta) -> bool:
    signer = get_signer(salt=salt)
    parsed_url = parse.urlparse(url)
    query_dict = parse.parse_qs(parsed_url.query)
    try:
        signature = query_dict[SIGNATURE_PARAMETER][0]
    except (KeyError, ValueError):
        return False
    value = f"{parsed_url.path}{signer.sep}{signature}"
    logging.warning(f"Verifying {max_age=} {salt=} {value=}")
    try:
        signer.unsign(value, max_age=max_age)
    except BadSignature:
        return False
    return True
