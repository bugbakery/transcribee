use crate::v1::{Accessor, Atom, Paragraph};
use transcribee_core::transcribee_document::v1::{self, Document, List};

fn main() {
    let doc = Document::new();
    let mut tx = doc.transaction();
    tx.set_paragraphs(vec![]);
    tx.paragraphs().insert(
        0,
        v1::Paragraph {
            speaker: None,
            lang: "de".to_owned(),
            atoms: List(vec![]),
        },
    );
    tx.commit();

    dbg!(doc.view().paragraphs().get(0).materialize());

    let tx = doc.transaction();
    tx.paragraphs().set(
        0,
        Paragraph {
            speaker: None,
            lang: "en".to_owned(),
            atoms: List(vec![Atom {
                text: "hello".to_string(),
                start: 0.0,
                end: 1.0,
                conf: 1.0,
            }]),
        },
    );

    dbg!(doc.view().paragraphs().get(0).materialize());
    tx.commit();
    dbg!(doc.view().paragraphs().get(0).materialize());
}
