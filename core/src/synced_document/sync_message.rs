#[derive(Clone)]
#[allow(dead_code)]
pub enum SyncMessage<'a> {
    Change(&'a [u8]),
    ChangeBacklogComplete,
    FullDocument(&'a [u8]),
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

impl<'a> From<SyncMessage<'a>> for Vec<u8> {
    fn from(val: SyncMessage<'a>) -> Self {
        let mut msg = vec![val.header()];

        match val {
            SyncMessage::Change(change) => msg.extend_from_slice(change),
            SyncMessage::ChangeBacklogComplete => (),
            SyncMessage::FullDocument(changes) => msg.extend_from_slice(changes),
        };

        msg
    }
}

pub struct SyncError;
impl<'a> TryFrom<&'a [u8]> for SyncMessage<'a> {
    type Error = SyncError;

    fn try_from(value: &'a [u8]) -> Result<Self, Self::Error> {
        match value[0] {
            1 => Ok(SyncMessage::Change(&value[1..])),
            2 => Ok(Self::ChangeBacklogComplete),
            3 => Ok(Self::FullDocument(&value[1..])),
            _ => Err(SyncError),
        }
    }
}
