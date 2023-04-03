import enum


class SyncMessageType(enum.IntEnum):
    CHANGE = 1
    CHANGE_BACKLOG_COMPLETE = 2
    FULL_DOCUMENT = 3
