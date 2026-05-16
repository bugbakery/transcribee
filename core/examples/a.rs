use transcribee_core::{A, BView};

fn main() -> transcribee_core::Result<()> {
  let b_view = BView::empty();

  let tx = b_view.into_transcation();
  tx.set_a(A { i1: 1.0 })?;
  tx.set_many_as(vec![A { i1: 2.0 }])?;
  let b_view = tx.commit();

  // b_view.dump();

  dbg!(b_view.a()?.i1()?);
  dbg!(b_view.many_as()?.get_obj(0)?.materialize());

  // let b = B::from(Automerge::new());
  // b.transaction()

  // b.transact_with(|aaa| {
  //   b.a.set_i1();
  // });

  // println!("{}", b.a.i1());
  // println!("{}", b.a.set_i1());

  Ok(())
}
