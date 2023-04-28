import secrets
import string

RANDOM_STRING_CHARS = string.ascii_letters + string.digits


def get_random_string(length=128, allowed_chars=RANDOM_STRING_CHARS):
    return "".join(secrets.choice(allowed_chars) for i in range(length))
