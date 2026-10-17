use std::{
    fs::File,
    io::{Read, Write},
};

use anyhow::Result;
use ndarray::{ArrayBase, ArrayD, Dimension, OwnedRepr};

pub fn read_ndarray_from_file(path: &str, shape: &[usize]) -> Result<ArrayD<f32>> {
    let mut f = File::open(path)?;
    let mut buf = Vec::with_capacity(f.metadata()?.len() as usize);
    f.read_to_end(&mut buf)?;

    let float_vec: Vec<f32> = buf
        .chunks_exact(4)
        .map(TryInto::try_into)
        .map(Result::unwrap)
        .map(f32::from_le_bytes)
        .collect();

    let ndarray = ArrayD::from_shape_vec(shape, float_vec)?;
    Ok(ndarray)
}

pub fn write_ndarray_to_file(
    path: &str,
    arr: &ArrayBase<OwnedRepr<f32>, impl Dimension>,
) -> Result<()> {
    let buf: Vec<u8> = arr.iter().flat_map(|x| x.to_le_bytes()).collect();
    let mut f = File::create(path)?;
    f.write_all(&buf)?;
    Ok(())
}

pub fn meanclose(
    a: ArrayBase<OwnedRepr<f32>, impl Dimension>,
    b: ArrayBase<OwnedRepr<f32>, impl Dimension>,
    max_delta: f32,
) -> bool {
    assert_eq!(a.shape(), b.shape());

    let mut max = 0.0;
    let mut sum = 0.0;
    let mut count = 0;
    for ((_ia, a), (_ib, b)) in a.indexed_iter().zip(b.indexed_iter()) {
        let diff = (a - b).abs();
        if diff > max {
            max = diff;
        }
        sum += diff;
        count += 1;
    }
    println!("max: {max}");
    let mean = sum / count as f32;
    println!("mean: {mean}");
    mean < max_delta
}
