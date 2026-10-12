//! This file contains the timing alignment code for whisper. It roughly corresponds to parts of
//! https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/timing.py

use anyhow::Result;
use ndarray::{Array2, Array3, ArrayD, Axis, s};

pub fn calculate_alignment(
    x: Array3<f32>, // [heads, tokens, encoder_frames]
    num_frames: usize,
) -> Result<Vec<usize>> {
    let x = x.slice_move(s![.., .., ..num_frames]);

    // 1. do softmax to the last axis (audio chunks)
    // this is already folded into the onnx model so we skip this step

    // 2. rescale by mean and std in the second to last axis (tokens)
    let std = x.std_axis(Axis(1), 0.0);
    let mean = x.mean_axis(Axis(1)).unwrap();
    let x = (x - mean.insert_axis(Axis(1))) / std.insert_axis(Axis(1));

    // 3. apply a median filter along the last axis (audio chunks) probably for denoising
    let x: Array3<f32> = median_filter::<7>(x.into_dyn())
        .into_dimensionality()
        .unwrap();

    // 4. take the mean of all heads
    let x = x.mean_axis(Axis(0)).unwrap();

    // 6. do dtw
    let dtw_result = dtw(-x.to_owned());

    // postprocess dtw output to be start & end time per token
    let mut jumps = vec![dtw_result.first().unwrap().1];
    for (token, frame) in dtw_result {
        if jumps.len() - 1 != token {
            jumps.push(frame);
        }
    }
    Ok(jumps)
}

fn median_filter<const WIDTH: usize>(x: ArrayD<f32>) -> ArrayD<f32> {
    let rank = x.shape().len();
    let mut filtered = ArrayD::<f32>::zeros(x.shape());
    let last_axis = Axis(rank);
    for (src, mut target) in x
        .lanes(last_axis)
        .into_iter()
        .zip(filtered.lanes_mut(last_axis))
    {
        for f in 0..src.len() {
            let window = &mut [0.0; WIDTH];
            for i in 0..WIDTH {
                let idx = f + i;
                let idx = if idx > WIDTH / 2 {
                    let idx = idx - WIDTH / 2;
                    if idx < src.len() {
                        idx
                    } else {
                        src.len() - (idx - src.len()) - 1
                    }
                } else {
                    WIDTH / 2 - idx
                };
                window[i] = *src.get(idx).unwrap();
            }
            window.sort_unstable_by(|a, b| a.total_cmp(b));
            *target.get_mut(f).unwrap() = window[WIDTH / 2];
        }
    }

    filtered
}

fn dtw(x: Array2<f32>) -> Vec<(usize, usize)> {
    let tokens = x.shape()[0];
    let frames = x.shape()[1];
    let mut cost = Array2::from_elem((tokens + 1, frames + 1), f32::INFINITY);
    let mut trace = Array2::from_elem((tokens + 1, frames + 1), -1i8);

    *cost.get_mut((0, 0)).unwrap() = 0.0;
    for frame in 1..frames + 1 {
        for token in 1..tokens + 1 {
            let c0 = cost.get((token - 1, frame - 1)).unwrap();
            let c1 = cost.get((token - 1, frame)).unwrap();
            let c2 = cost.get((token, frame - 1)).unwrap();

            let (c, t) = if c0 < c1 && c0 < c2 {
                (c0, 0)
            } else if c1 < c0 && c1 < c2 {
                (c1, 1)
            } else {
                (c2, 2)
            };

            *cost.get_mut((token, frame)).unwrap() = x.get((token - 1, frame - 1)).unwrap() + c;
            *trace.get_mut((token, frame)).unwrap() = t;
        }
    }
    backtrace(&mut trace)
}

fn backtrace(trace: &mut Array2<i8>) -> Vec<(usize, usize)> {
    let mut token = trace.shape()[0] - 1;
    let mut frame = trace.shape()[1] - 1;
    for f in 0..frame {
        *trace.get_mut((0, f)).unwrap() = 2
    }
    for t in 0..token {
        *trace.get_mut((t, 0)).unwrap() = 1
    }

    let mut result = vec![];
    while token > 0 || frame > 0 {
        result.push((token - 1, frame - 1));
        let elem = *trace.get((token, frame)).unwrap();
        if elem == 0 {
            token -= 1;
            frame -= 1;
        } else if elem == 1 {
            token -= 1;
        } else if elem == 2 {
            frame -= 1;
        } else {
            unreachable!();
        }
    }
    result.reverse();

    result
}
