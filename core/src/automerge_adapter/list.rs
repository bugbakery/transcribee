use std::marker::PhantomData;

use automerge::{ObjId, Prop, ReadDoc, hydrate, transaction::Transactable};

use super::{Accessor, WithDoc};

#[derive(Debug)]
pub struct List<V>(pub Vec<V>);

impl<V: Into<hydrate::Value>> Into<hydrate::Value> for List<V> {
    fn into(self) -> hydrate::Value {
        hydrate::Value::from(
            self.0
                .into_iter()
                .map(|v| v.into())
                .collect::<Vec<hydrate::Value>>(),
        )
    }
}

pub struct ListAccessor<T, V> {
    doc: T,
    obj_id: ObjId,
    _marker: PhantomData<V>,
}

impl<T, V: Accessor<T>> Accessor<T> for ListAccessor<T, V> {
    type Hydrate = List<V::Hydrate>;

    fn new(doc: T, obj_id: ObjId) -> Self {
        Self {
            doc,
            obj_id,
            _marker: Default::default(),
        }
    }

    fn read_from<D: ReadDoc>(doc: &T, obj_id: &ObjId, prop: impl Into<Prop>) -> Self
    where
        T: WithDoc<Target = D>,
    {
        doc.read_list(obj_id, prop)
    }

    fn materialize<D: ReadDoc>(&self) -> Self::Hydrate
    where
        T: WithDoc<Target = D>,
    {
        List(self.into_iter().map(|d| d.materialize()).collect())
    }
}

impl<T: WithDoc<Target = V>, V: ReadDoc, VV: Accessor<T>> ListAccessor<T, VV> {
    pub fn get(&self, idx: usize) -> VV {
        VV::read_from(&self.doc, &self.obj_id, idx)
    }

    pub fn length(&self) -> usize {
        self.doc.with_doc(|doc| doc.length(&self.obj_id))
    }

    pub fn into_iter(&self) -> impl Iterator<Item = VV> {
        (0..self.length()).map(|i| self.get(i))
    }
}

impl<T: WithDoc<Target = V>, V: Transactable, VV: Accessor<T>> ListAccessor<T, VV> {
    pub fn set(&mut self, idx: usize, value: VV::Hydrate) {
        self.doc.write_hydrate(&self.obj_id, idx, value, false);
    }

    pub fn insert(&mut self, idx: usize, value: VV::Hydrate) {
        self.doc.write_hydrate(&self.obj_id, idx, value, true)
    }
}
