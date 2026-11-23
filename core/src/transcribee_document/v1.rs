use automerge::{
    Automerge, ObjId, Prop, ROOT, ReadDoc, hydrate, hydrate_map, transaction::Transactable,
};

use crate::automerge_adapter::WithDoc;

pub use crate::automerge_adapter::{Accessor, DocHandle, List, ListAccessor, TxHandle};

pub struct Document {
    root_doc: DocHandle,
}

pub struct DocumentAccessor<T> {
    doc: T,
    obj_id: ObjId,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    pub fn view(&self) -> DocumentAccessor<DocHandle> {
        DocumentAccessor {
            doc: DocHandle::new(self.root_doc.fork()),
            obj_id: ROOT,
        }
    }

    pub fn transaction(&self) -> DocumentAccessor<TxHandle> {
        DocumentAccessor {
            doc: TxHandle::new(
                self.root_doc.clone(),
                self.root_doc.fork().into_transaction(None, None),
            ),
            obj_id: ROOT,
        }
    }

    pub fn new() -> Self {
        Self {
            root_doc: DocHandle::new(Automerge::new()),
        }
    }
}

impl DocumentAccessor<TxHandle> {
    pub fn commit(self) {
        self.doc.commit();
    }
}

impl<T: WithDoc<Target = V>, V: ReadDoc> DocumentAccessor<T> {
    pub fn version(&self) -> i64 {
        self.doc.read_scalar(&self.obj_id, "version")
    }

    pub fn paragraphs(&self) -> ListAccessor<T, ParagraphAccessor<T>> {
        self.doc.read_list(&self.obj_id, "paragraphs")
    }
}

impl<T: WithDoc<Target = V>, V: Transactable> DocumentAccessor<T> {
    pub fn set_version(&self, version: i64) {
        self.doc.write_scalar(&self.obj_id, "version", version)
    }

    pub fn set_paragraphs(&mut self, paragraphs: impl IntoIterator<Item = Paragraph>) {
        self.doc.write_list(&self.obj_id, "paragraphs", paragraphs)
    }
}

#[derive(Debug)]
pub struct Paragraph {
    pub speaker: Option<String>,
    pub lang: String,
    pub atoms: List<Atom>,
}

impl From<Paragraph> for hydrate::Value {
    fn from(val: Paragraph) -> Self {
        let speaker = match val.speaker {
            Some(speaker) => speaker.as_str().into(),
            None => hydrate::Value::Scalar(automerge::ScalarValue::Null),
        };
        hydrate::Value::Map(hydrate_map!(
          "speaker" => speaker,
          "lang" => val.lang.as_str(),
          "atoms" => <List::<Atom> as Into<hydrate::Value>>::into(val.atoms)
        ))
    }
}

pub struct ParagraphAccessor<T> {
    doc: T,
    obj_id: ObjId,
}

impl<T> Accessor<T> for ParagraphAccessor<T> {
    type Hydrate = Paragraph;

    fn new(doc: T, obj_id: ObjId) -> Self {
        Self { doc, obj_id }
    }

    fn read_from<D: ReadDoc>(doc: &T, obj_id: &ObjId, prop: impl Into<Prop>) -> Self
    where
        T: WithDoc<Target = D>,
    {
        doc.read_obj(obj_id, prop)
    }

    fn materialize<D: ReadDoc>(&self) -> Paragraph
    where
        T: WithDoc<Target = D>,
    {
        Paragraph {
            speaker: self.doc.read_scalar(&self.obj_id, "speaker"),
            lang: self.doc.read_scalar(&self.obj_id, "lang"),
            atoms: self
                .doc
                .read_list::<AtomAccessor<_>>(&self.obj_id, "atoms")
                .materialize(),
        }
    }
}

#[derive(Debug)]
pub struct Atom {
    pub text: String,
    pub start: f64, // in seconds
    pub end: f64,   // in seconds
    pub conf: f64,  // confidence ~ logit probability
}

impl From<Atom> for hydrate::Value {
    fn from(val: Atom) -> Self {
        hydrate::Value::Map(hydrate_map!(
          "text" => hydrate::Value::text(automerge::TextEncoding::Utf8CodeUnit, &val.text),
          "start" => val.start,
          "end" => val.end,
          "conf" => val.conf,
        ))
    }
}

struct AtomAccessor<T> {
    doc: T,
    obj_id: ObjId,
}

impl<T> Accessor<T> for AtomAccessor<T> {
    type Hydrate = Atom;

    fn new(doc: T, obj_id: ObjId) -> Self {
        Self { doc, obj_id }
    }

    fn read_from<D: ReadDoc>(doc: &T, obj_id: &ObjId, prop: impl Into<Prop>) -> Self
    where
        T: WithDoc<Target = D>,
    {
        doc.read_obj(obj_id, prop)
    }

    fn materialize<D: ReadDoc>(&self) -> Atom
    where
        T: WithDoc<Target = D>,
    {
        Atom {
            text: self.text(),
            start: self.start(),
            end: self.end(),
            conf: self.conf(),
        }
    }
}

impl<T: WithDoc<Target = V>, V: ReadDoc> AtomAccessor<T> {
    pub fn text(&self) -> String {
        self.doc.read_scalar(&self.obj_id, "text")
    }

    pub fn start(&self) -> f64 {
        self.doc.read_scalar(&self.obj_id, "start")
    }

    pub fn end(&self) -> f64 {
        self.doc.read_scalar(&self.obj_id, "end")
    }

    pub fn conf(&self) -> f64 {
        self.doc.read_scalar(&self.obj_id, "conf")
    }
}

uniffi::setup_scaffolding!();
mod ffi {
    use wasm_bindgen::prelude::*;

    use crate::automerge_adapter::DocHandle;
    use crate::automerge_adapter::TxHandle;

    use super::Document as RustDocument;
    use super::DocumentAccessor;

    #[wasm_bindgen]
    // #[derive(uniffi::Object)]
    pub struct Document(RustDocument);

    #[wasm_bindgen]
    // #[derive(uniffi::Object)]
    pub struct DocumentView(DocumentAccessor<DocHandle>);

    #[wasm_bindgen]
    // #[derive(uniffi::Object)]
    pub struct DocumentTransaction(DocumentAccessor<TxHandle>);

    #[wasm_bindgen]
    // #[uniffi::export]
    impl Document {
        #[wasm_bindgen(constructor)]
        #[uniffi::constructor]
        pub fn new() -> Self {
            Document(RustDocument::new())
        }

        pub fn view(&self) -> DocumentView {
            DocumentView(self.0.view())
        }

        pub fn transaction(&self) -> DocumentTransaction {
            DocumentTransaction(self.0.transaction())
        }
    }

    #[wasm_bindgen]
    // #[uniffi::export]
    impl DocumentView {
        #[wasm_bindgen(getter)]
        pub fn version(&self) -> i64 {
            self.0.version()
        }
    }

    #[wasm_bindgen]
    // #[uniffi::export]
    impl DocumentTransaction {
        #[wasm_bindgen(getter)]
        pub fn version(&self) -> i64 {
            self.0.version()
        }

        #[wasm_bindgen(setter)]
        pub fn set_version(&self, version: i64) {
            self.0.set_version(version)
        }

        pub fn commit(&self) {
            self.0.doc.commit();
        }
    }
}
