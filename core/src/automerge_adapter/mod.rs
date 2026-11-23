use automerge::{
    hydrate,
    transaction::{OwnedTransaction, Transactable},
    Automerge, ObjId, ObjType, Prop, ReadDoc, ScalarValue, Value,
};
use std::sync::{Arc, Mutex};

pub(crate) mod from_hydrate;
pub(crate) mod list;
pub use list::*;

pub(crate) mod accessor;
pub use accessor::*;

use from_hydrate::FromHydrate;

// use interior mutability + mutex for python support
#[derive(Clone)]
pub struct DocHandle(Arc<Mutex<Automerge>>);

#[derive(Clone)]
pub struct TxHandle {
    tx: Arc<Mutex<Option<OwnedTransaction>>>,
    root_doc: DocHandle,
}

impl DocHandle {
    pub(crate) fn new(doc: Automerge) -> Self {
        Self(Arc::new(Mutex::new(doc)))
    }

    pub(crate) fn fork(&self) -> Automerge {
        self.with_doc(|doc| doc.fork())
    }

    fn merge(&self, mut other: Automerge) {
        self.with_doc(|doc| doc.merge(&mut other)).unwrap();
    }
}

pub trait WithDoc: Clone + Sized {
    type Target;
    fn with_doc<R>(&self, cb: impl FnOnce(&mut Self::Target) -> R) -> R;

    fn read_list<V: Accessor<Self>>(
        &self,
        obj_id: &ObjId,
        prop: impl Into<Prop>,
    ) -> ListAccessor<Self, V>
    where
        Self::Target: ReadDoc,
    {
        self.with_doc(move |doc| {
            let (value, obj_id) = doc.get(obj_id, prop).unwrap().unwrap();
            assert!(matches!(value, Value::Object(ObjType::List)));

            ListAccessor::new(self.clone(), obj_id)
        })
    }

    fn read_obj<V: Accessor<Self>>(&self, obj_id: &ObjId, prop: impl Into<Prop>) -> V
    where
        Self::Target: ReadDoc,
    {
        self.with_doc(move |doc| {
            let (value, obj_id) = doc.get(obj_id, prop).unwrap().unwrap();
            assert!(matches!(value, Value::Object(ObjType::Map)));
            V::new(self.clone(), obj_id)
        })
    }

    fn read_scalar<V: FromHydrate>(&self, obj_id: &ObjId, prop: impl Into<Prop>) -> V
    where
        Self::Target: ReadDoc,
    {
        self.with_doc(move |doc| {
            let (value, _) = doc.get(obj_id, prop).unwrap().unwrap();
            V::from_hydrate(hydrate::Value::new(value, doc.text_encoding()))
        })
    }

    fn write_hydrate(
        &self,
        obj_id: &ObjId,
        prop: impl Into<Prop>,
        value: impl Into<hydrate::Value>,
        insert: bool,
    ) where
        Self::Target: Transactable,
    {
        self.with_doc(move |doc| doc.batch_create_object(obj_id, prop, &value.into(), insert))
            .unwrap();
    }

    fn write_list(
        &mut self,
        obj_id: &ObjId,
        prop: impl Into<Prop>,
        value: impl IntoIterator<Item = impl Into<hydrate::Value>>,
    ) where
        Self::Target: Transactable,
    {
        self.with_doc(move |doc| {
            let id = doc.put_object(obj_id, prop, ObjType::List).unwrap();
            doc.splice(id, 0, 0, value).unwrap()
        })
    }

    fn write_scalar(&self, obj_id: &ObjId, prop: impl Into<Prop>, value: impl Into<ScalarValue>)
    where
        Self::Target: Transactable,
    {
        self.with_doc(move |doc| doc.put(obj_id, prop, value).unwrap())
    }
}

impl WithDoc for DocHandle {
    type Target = Automerge;
    fn with_doc<R>(&self, cb: impl FnOnce(&mut Self::Target) -> R) -> R {
        cb(&mut *self.0.lock().unwrap())
    }
}

impl TxHandle {
    pub(crate) fn new(root_doc: DocHandle, tx: OwnedTransaction) -> Self {
        Self {
            root_doc,
            tx: Arc::new(Mutex::new(Some(tx))),
        }
    }

    pub(crate) fn commit(&self) {
        let tx = self.tx.lock().unwrap().take().unwrap();
        let (doc, _, _) = tx.commit();

        self.root_doc.merge(doc);
    }
}

impl WithDoc for TxHandle {
    type Target = OwnedTransaction;
    fn with_doc<R>(&self, cb: impl FnOnce(&mut Self::Target) -> R) -> R {
        cb(&mut *self.tx.lock().unwrap().as_mut().unwrap())
    }
}
