use crate::whisper::decoder::ALIGNMENT_HEADS;
use anyhow::Result;
use ndarray::{Array2, Array3, Axis};

#[derive(Clone, Default, Debug)]
pub struct AlignmentData(Vec<Array3<f32>>); // alignment_heads, tokens, encoder_frames
impl AlignmentData {
    // TODO: this is shit inefficient; reshape the outputs so that we just need to extract one tensor
    pub fn add_cross_attention_weights(
        &mut self,
        outputs: &ort::session::SessionOutputs<'_>,
        batch_idx: usize,
    ) -> Result<()> {
        let mut cross_attentions = Vec::new();
        for i in 0..4 {
            let data = outputs[format!("cross_attentions.{i}")]
                .try_extract_array::<f32>()
                .unwrap();
            cross_attentions.push(data);
        }

        let tokens = cross_attentions[0].shape()[2];
        let encoder_frames = cross_attentions[0].shape()[3];

        let mut next = Array3::<f32>::zeros((ALIGNMENT_HEADS.len(), tokens, encoder_frames));
        for (head_idx, (block, idx)) in ALIGNMENT_HEADS.into_iter().enumerate() {
            for token in 0..tokens {
                for audio_frame in 0..encoder_frames {
                    *next.get_mut((head_idx, token, audio_frame)).unwrap() = *cross_attentions
                        [block]
                        .get([batch_idx, idx, token, audio_frame])
                        .unwrap();
                }
            }
        }

        self.0.push(next);
        Ok(())
    }

    fn get_merged(&self, num_frames: usize) -> Array3<f32> {
        let heads = self.0[0].shape()[0];
        let tokens = self.0.iter().map(|x| x.shape()[1]).sum();
        let encoder_frames = self.0[0].shape()[2];
        assert!(num_frames <= encoder_frames);

        let mut merged = Array3::zeros((heads, tokens, num_frames));
        let mut tokens_processed = 0;
        for slice in self.0.iter() {
            assert_eq!(slice.shape()[0], heads);
            let slice_tokens = slice.shape()[1];
            assert_eq!(slice.shape()[2], encoder_frames);
            for h in 0..heads {
                for t in 0..slice_tokens {
                    for f in 0..num_frames {
                        *merged.get_mut((h, t + tokens_processed, f)).unwrap() =
                            *slice.get((h, t, f)).unwrap();
                    }
                }
            }

            tokens_processed += slice_tokens;
        }

        merged
    }

    pub fn calculate_alignment(&self, num_frames: usize) -> Result<Vec<usize>> {
        let merged = self.get_merged(num_frames);
        let heads = merged.shape()[0];
        let tokens = merged.shape()[1];
        let frames = merged.shape()[2];

        // 1. do softmax to the last axis (audio chunks)
        // this is already folded into the onnx model so we skip this step
        // let mut divisor = Array4::<f32>::zeros((batch_size, heads, tokens, 1));
        // for b in 0..batch_size {
        //     for h in 0..heads {
        //         for t in 0..tokens {
        //             *divisor.get_mut((b, h, t, 0)).unwrap() = (0..frames)
        //                 .map(|f| merged.get((b, h, t, f)).unwrap().exp())
        //                 .sum()
        //         }
        //     }
        // }
        // let softmaxed = merged.exp() / divisor;

        // 2. rescale by mean and std in the second to last axis (tokens)
        let std = merged.std_axis(Axis(1), 0.0);
        let mean = merged.mean_axis(Axis(1)).unwrap();
        let scaled = (merged - mean.insert_axis(Axis(1))) / std.insert_axis(Axis(1));

        // 3. apply a median filter along the last axis (audio chunks) probably for denoising
        const MEDFILT_WIDTH: usize = 7;
        let mut filtered = Array3::zeros((heads, tokens, frames));
        for h in 0..heads {
            for t in 0..tokens {
                for f in 0..frames {
                    let window = &mut [0.0; MEDFILT_WIDTH];
                    for x in 0..MEDFILT_WIDTH {
                        let idx = f + x;
                        let idx = if idx > MEDFILT_WIDTH / 2 {
                            let idx = idx - MEDFILT_WIDTH / 2;
                            if idx < frames {
                                idx
                            } else {
                                frames - (idx - frames) - 1
                            }
                        } else {
                            MEDFILT_WIDTH / 2 - idx
                        };
                        window[x] = *scaled.get((h, t, idx)).unwrap();
                    }
                    window.sort_unstable_by(|a, b| a.total_cmp(b));
                    *filtered.get_mut((h, t, f)).unwrap() = window[MEDFILT_WIDTH / 2];
                }
            }
        }

        // 4. take the mean of all heads
        let heads_combined = filtered.mean_axis(Axis(0)).unwrap();

        // 6. do dtw
        let dtw_result = Self::dtw(-heads_combined.to_owned());

        // postprocess dtw output to be start & end time per token
        let mut jumps = vec![dtw_result.first().unwrap().1];
        for (token, frame) in dtw_result {
            if jumps.len() - 1 != token {
                jumps.push(frame);
            }
        }
        Ok(jumps)
    }

    fn dtw(x: Array2<f32>) -> Vec<(usize, usize)> {
        let tokens = x.shape()[0];
        let frames = x.shape()[1];
        dbg!(tokens, frames);
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
        Self::backtrace(&mut trace)
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
}
