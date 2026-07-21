use axum::{body::Bytes, extract::ws::Message};

#[derive(Clone)]
#[allow(dead_code)]
pub enum SyncMessage<'a> {
    Change(&'a [u8]),
    ChangeBacklogComplete,
    FullDocument(&'a [&'a [u8]]),
}

impl<'a> SyncMessage<'a> {
    pub fn header(&self) -> u8 {
        match self {
            SyncMessage::Change(..) => 1,
            SyncMessage::ChangeBacklogComplete => 2,
            SyncMessage::FullDocument(..) => 3,
        }
    }
}

impl<'a> Into<Message> for SyncMessage<'a> {
    fn into(self) -> Message {
        let mut msg = vec![self.header()];

        match self {
            SyncMessage::Change(change) => msg.extend_from_slice(change),
            SyncMessage::ChangeBacklogComplete => (),
            SyncMessage::FullDocument(changes) => {
                for c in changes {
                    msg.extend_from_slice(c);
                }
            }
        };

        Message::Binary(Bytes::from(msg))
    }
}
