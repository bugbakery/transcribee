use super::WithDoc;
use automerge::{ObjId, Prop, ReadDoc, hydrate};

pub trait Accessor<T> {
    type Hydrate: Into<hydrate::Value>;

    fn new(doc: T, obj_id: ObjId) -> Self;

    fn read_from<D: ReadDoc>(doc: &T, obj_id: &ObjId, prop: impl Into<Prop>) -> Self
    where
        T: WithDoc<Target = D>;

    fn materialize<D: ReadDoc>(&self) -> Self::Hydrate
    where
        T: WithDoc<Target = D>;
}
