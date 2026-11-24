use std::{collections::HashMap, iter::once};

use automerge::Change;

use crate::{
    automerge_adapter::{Accessor, DocHandle, WithDoc},
    transcribee_document::v1::{Document, Paragraph},
};

struct SendError(String);
trait Transport {
    fn register_on_packet(&mut self, f: impl Fn(&[u8]) + 'static);
    fn send(&self, data: &[u8]) -> Result<(), SendError>;
}

struct SyncedDocument<T> {
    doc_handle: DocHandle,
    transport: T,
    doc: Document,
    paragraph_listeners: HashMap<usize, Vec<Box<dyn Fn(Paragraph)>>>,
}

impl<T: Transport> SyncedDocument<T> {
    pub fn new(transport: T) -> Self {
        let mut synced_doc = SyncedDocument {
            doc_handle: DocHandle::new(automerge::Automerge::new()),
            transport,
            doc: Document::new(),
            paragraph_listeners: Default::default(),
        };

        let doc_handle = synced_doc.doc_handle.clone();
        synced_doc.transport.register_on_packet(move |data| {
            let change = Change::from_bytes(data.to_vec());
            match change {
                Ok(change) => {
                    doc_handle.with_doc(|doc| {
                        doc.apply_changes(once(change));
                    });
                }
                Err(e) => println!("{e:?}"),
            }
        });

        synced_doc
    }

    pub fn get_paragraph(&self, idx: usize) -> Paragraph {
        self.doc.view().paragraphs().get(idx).materialize()
    }

    pub fn register_paragraph_change_listener(
        &mut self,
        idx: usize,
        f: impl Fn(Paragraph) + 'static,
    ) {
        self.paragraph_listeners
            .entry(idx)
            .or_default()
            .push(Box::new(f));
    }
}

mod ffi {
    use js_sys::{Uint8Array, Undefined};
    use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

    use super::{SendError, SyncedDocument as RustSyncedDocument};
    use crate::transcribee_document::v1::Paragraph as RustParagraph;

    #[wasm_bindgen]
    pub struct Transport {
        listener: Option<Box<dyn Fn(&[u8])>>,
        send_impl: js_sys::Function<fn(Uint8Array) -> Undefined>,
    }

    // const t = new Transport((d) => {
    //     ws.send(d);
    // })
    // ws.on('message', (d) => {
    //     t.recv(d);
    // })
    #[wasm_bindgen]
    impl Transport {
        pub fn new(send_impl: js_sys::Function<fn(Uint8Array) -> Undefined>) -> Transport {
            Transport {
                listener: None,
                send_impl,
            }
        }

        pub fn recv(&self, data: &[u8]) {
            if let Some(ref listener) = self.listener {
                listener(data);
            }
        }
    }

    impl super::Transport for Transport {
        fn register_on_packet(&mut self, f: impl Fn(&[u8]) + 'static) {
            self.listener = Some(Box::new(f));
        }

        fn send(&self, data: &[u8]) -> Result<(), SendError> {
            self.send_impl
                .call(&JsValue::null(), (&Uint8Array::new_from_slice(data),))
                .map_err(|e| SendError(e.as_string().unwrap_or("Unknown JS error".to_string())))?;

            Ok(())
        }
    }

    #[wasm_bindgen]
    pub struct SyncedDocument(RustSyncedDocument<Transport>);

    #[wasm_bindgen]
    pub struct Paragraph(RustParagraph);

    #[wasm_bindgen]
    impl SyncedDocument {
        #[wasm_bindgen(constructor)]
        pub fn new(transport: Transport) -> Self {
            SyncedDocument(RustSyncedDocument::new(transport))
        }

        pub fn get_paragraph(&self, idx: usize) -> Paragraph {
            Paragraph(self.0.get_paragraph(idx))
        }
    }
}
