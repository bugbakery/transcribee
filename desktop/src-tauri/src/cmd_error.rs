use log::error;
use serde::Serialize;
use std::fmt::{Debug, Display};

pub type CmdResult<T> = Result<T, CmdError>;

pub struct CmdError {
    err: String,
}
impl Serialize for CmdError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.err)
    }
}
impl<E: Debug + Display> From<E> for CmdError {
    fn from(error: E) -> Self {
        let err = format!("{:?}", error);
        error!("{err}");
        Self { err }
    }
}
impl Debug for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.err)
    }
}
