use std::fmt::Debug;
use std::hash::Hash;
use std::sync::Arc;

#[derive(Clone)]
pub struct Handle(Arc<()>);
impl Handle {
    pub fn new() -> Self {
        Self(Arc::new(()))
    }
}
impl PartialEq for Handle {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for Handle {}
impl Debug for Handle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!(
            "KVCacheKey({:X})",
            self.0.as_ref() as *const _ as usize
        ))
    }
}
impl Hash for Handle {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        (self.0.as_ref() as *const _ as usize).hash(state);
    }
}
