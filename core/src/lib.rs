use wasm_bindgen::prelude::*;
use std::{cell::RefCell, rc::Rc};

use automerge::{Automerge, ROOT, ReadDoc, Value, hydrate, hydrate_map, transaction::OwnedTransaction};
use automerge::transaction::Transactable;

use pyo3::pyclass;


pub type Result<T> = std::result::Result<T, TranscribeeError>;

#[derive(Clone)]
struct DocHandle(Rc<RefCell<Option<Automerge>>>);

#[derive(Clone)]
struct TxHandle(Rc<RefCell<Option<OwnedTransaction>>>);

impl DocHandle {
  fn with_doc<R>(&self, cb: impl FnOnce(&Automerge) -> R) -> R {
    cb(&*self.0.borrow().as_ref().unwrap())
  }

  fn with_doc_mut<R>(&self, cb: impl FnOnce(&mut Automerge) -> R) -> R {
    cb(&mut *self.0.borrow_mut().as_mut().unwrap())
  }
}

impl TxHandle {
  fn with_doc<R>(&self, cb: impl FnOnce(&OwnedTransaction) -> R) -> R {
    cb(&*self.0.borrow().as_ref().unwrap())
  }

  fn with_doc_mut<R>(&self, cb: impl FnOnce(&mut OwnedTransaction) -> R) -> R {
    cb(&mut *self.0.borrow_mut().as_mut().unwrap())
  }
}

use automerge::{ObjId, Prop, ScalarValue};

macro_rules! mapped_thing {
  {
    struct $name:ident $view_name:ident $tx_name:ident {
      $(@[$obj_name:ident, $obj_setter:ident] : [$obj_ty:ident, $obj_view_ty:ident, $obj_tx_ty:ident]),*
      $([$scalar_name:ident, $scalar_setter:ident] : $scalar_ty:ident),*
    }
  } => {
    #[wasm_bindgen]
    #[pyclass]
    pub struct $view_name {
      doc: DocHandle,
      obj_id: ObjId
    }

    #[wasm_bindgen]
    pub struct $tx_name {
      doc: TxHandle,
      obj_id: ObjId
    }

    #[wasm_bindgen(getter_with_clone)]
    #[derive(Debug, Clone)]
    pub struct $name {
      $(pub $obj_name: $obj_ty),*
      $(pub $scalar_name: $scalar_ty),*
    }

    #[wasm_bindgen]
    impl $name {
      #[wasm_bindgen(constructor)]
      pub fn new($($obj_name: $obj_ty),* $($scalar_name: $scalar_ty),*) -> Self {
        Self {
          $($obj_name),*
          $($scalar_name),*
        }
      }
    }

    impl $view_name {
      fn new(doc: DocHandle, obj_id: ObjId) -> Self {
        Self {
          doc, obj_id
        }
      }
    }

    #[wasm_bindgen]
    impl $view_name {
      $(
    #[wasm_bindgen(getter)]
pub fn $obj_name(&self) -> Result<$obj_view_ty> {
        mapped_thing! { @pop_obj self, $obj_name, $obj_view_ty }
      })*

      $(
    #[wasm_bindgen(getter)]
pub fn $scalar_name(&self) -> Result<$scalar_ty> {
        mapped_thing! { @pop_scalar self, $scalar_name, $scalar_ty }
      })*
    }

    impl $tx_name {
      fn new(doc: TxHandle, obj_id: ObjId) -> Self {
        Self {
          doc, obj_id
        }
      }
    }

    #[wasm_bindgen]
    impl $tx_name {

      $(
    #[wasm_bindgen(getter)]
pub fn $obj_name(&self) -> Result<$obj_tx_ty> {
        mapped_thing! { @pop_obj self, $obj_name, $obj_tx_ty }
      })*

//   pub fn set_a(&mut self, value: A) -> anyhow::Result<()> {
//     self.doc.batch_create_object(ROOT, "a", &value.into(), false)?;
//     Ok(())

      $(
    #[wasm_bindgen(setter)]
pub fn $obj_setter(&self, value: $obj_ty) -> Result<()>
{
        self.doc.with_doc_mut(|tx| value.put(tx, &self.obj_id, stringify!($obj_name)));
        Ok(())
      })*

      $(pub fn $scalar_name(&self) -> Result<$scalar_ty> {
        mapped_thing! { @pop_scalar self, $scalar_name, $scalar_ty }
      })*
    }
  };


  { @pop_obj $self:ident, $name:ident, $res:ident } => {
    $self.doc.with_doc(|doc| {
      let (value, id) = doc.get(&$self.obj_id, stringify!($name)).unwrap().unwrap();
      assert!(matches!(value, Value::Object(_)));
      Ok($res {
        doc: $self.doc.clone(),
        obj_id: id
      })
    })
  };

  { @pop_scalar $self:ident, $name:ident, $res:ident } => {
    $self.doc.with_doc(|doc| {
      let (value, _) = doc.get(&$self.obj_id, stringify!($name)).unwrap().unwrap();
      if let Value::Scalar(std::borrow::Cow::Owned(mapped_thing!(@scalar_to_ty $res val))) = value {
        Ok(val)
      } else {
        unimplemented!()
      }
    })
  };

  (@scalar_to_ty f64 $e:ident) => { ScalarValue::F64($e) }
}

type ListOfA = Vec<A>;

mapped_thing! {
  struct B BView BTransaction {
    @[a, set_a]: [A, AView, ATransaction],
    @[many_as, set_many_as]: [ListOfA, ListOfAView, ListOfATransaction]
  }
}

mapped_thing! {
  struct A AView ATransaction {
    [i1, set_i1]: f64
  }
}

impl Into<hydrate::Value> for A {
  fn into(self) -> hydrate::Value {
    hydrate::Value::Map(hydrate_map!(
      "i1" => self.i1
    ))
  }
}

impl AView {
  pub fn materialize(&self) -> A {
    A {
      i1: self.i1().unwrap()
    }
  }
}

#[wasm_bindgen]
pub struct ListOfAView {
  doc: DocHandle,
  obj_id: ObjId
}

#[wasm_bindgen]
pub struct ListOfATransaction {
  doc: TxHandle,
  obj_id: ObjId
}

impl ListOfAView {
  pub fn len(&self) -> usize {
    self.doc.with_doc(|doc| doc.length(&self.obj_id))
  }

  pub fn get_obj(&self, idx: usize) -> Result<AView> {
    self.doc.with_doc(|doc| {
      let (value, id) = doc.get(&self.obj_id, idx).unwrap().unwrap();
      assert!(matches!(value, Value::Object(_)));
      Ok(AView::new(self.doc.clone(), id))
    })
  }
}

// impl BView {
//   pop_obj! { a, AView }
//   pop_obj! { many_as, ListOfAView }
// }

// pub struct BTransaction {
//   doc: TxHandle,
//   obj_id: ObjId
// }

// impl BTransaction {
//   pop_obj! { a, ATransaction }
//   pop_obj! { many_as, ListOfATransaction }
// }

// macro_rules! {

// }

// impl<'a, T: Transactable> BView<&mut T> {
//   pub fn set_a(&mut self, value: A) -> anyhow::Result<()> {
//     self.doc.batch_create_object(ROOT, "a", &value.into(), false)?;
//     Ok(())
//   }

//   pub fn set_many_as(&mut self, value: Vec<A>) {
//     let id = self.doc.put_object(ROOT, "many_as", automerge::ObjType::List).unwrap();

//     self.doc.splice(id, 0, 0, value).unwrap();
//   }
// }

trait WritableToDoc: Sized {
  fn put<T: Transactable, P: Into<Prop>>(self, doc: &mut T, obj: &ObjId, prop: P) -> ();
}

impl WritableToDoc for Vec<A> {
  fn put<T: Transactable, P: Into<Prop>>(self, doc: &mut T, obj: &ObjId, prop: P) -> () {
      let id = doc.put_object(obj, prop, automerge::ObjType::List).unwrap();

      doc.splice(id, 0, 0, self).unwrap();
    }
}

impl WritableToDoc for A {
  fn put<T: Transactable, P: Into<Prop>>(self, doc: &mut T, obj: &ObjId, prop: P) -> () {
    doc.batch_create_object(obj, prop.into(), &self.into(), false).unwrap();
  }
}

#[wasm_bindgen]
impl BView {
  pub fn empty() -> Self {
    Self::from_doc(Automerge::new())
  }

  pub fn into_transcation(self) -> BTransaction {
    BTransaction {
      doc: TxHandle(Rc::new(RefCell::new(Some(self.doc.0.borrow_mut().take().unwrap().into_transaction(None, None))))),
      obj_id: ROOT
    }
  }

  pub fn dump(&self) {
    self.doc.with_doc(|doc| doc.dump());
  }
}


impl BView {
  pub fn from_doc(doc: Automerge) -> Self {
    Self {
      doc: DocHandle(Rc::new(RefCell::new(Some(doc)))),
      obj_id: ROOT
    }
  }
}

#[wasm_bindgen]
impl BTransaction {
  pub fn commit(self) -> BView {
    let (doc, _, _) = self.doc.0.borrow_mut().take().unwrap().commit();
    BView {
      doc: DocHandle(Rc::new(RefCell::new(Some(doc)))),
      obj_id: ROOT
    }
  }
}

#[derive(Debug)]
pub enum TranscribeeError {
    AutomergeError(automerge::AutomergeError)
}

impl Into<JsValue> for TranscribeeError {
    fn into(self) -> JsValue {
      JsValue::from_str(format!("{:?}", self).as_str())
    }
}

// impl From<AutomergeError> for PyErr {
//     fn from(error: TranscribeeError) -> Self {
//         match error {
//             TranscribeeError::AutomergeError(e) => {
//                 PyException::new_err(format!("Automerge error: {}", e))
//             }
//         }
//     }
// }
