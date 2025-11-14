import enum

# The sync protocol is used to transmit the loro document over websockets.
# Each websocket packet is started by an 8 bit SyncMessageType following one or more
# loro updates that are each preceded by a 32bit big endian integer that specifies
# the length of the following message.

class SyncMessageType(enum.IntEnum):
    CHANGE = 1
    BACKLOG_COMPLETE = 2
