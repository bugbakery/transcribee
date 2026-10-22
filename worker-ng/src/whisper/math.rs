use ndarray::{ArrayD, Axis};

pub fn softmax(x: ArrayD<f32>, axis: Axis) -> ArrayD<f32> {
    let mut result = ArrayD::zeros(x.shape());
    for (src, mut target) in x.lanes(axis).into_iter().zip(result.lanes_mut(axis)) {
        let exponentiated = src.exp();
        let sum = exponentiated.sum();
        target.assign(&(exponentiated / sum));
    }
    result
}
