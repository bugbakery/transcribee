import datetime


def now_tz_aware() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)
