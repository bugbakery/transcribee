use log::{debug, warn};
use std::ops::Range;

use crate::audio_reader::format_time;

// TODO: this probably wants to live in the VAD code as it is VAD engine specific
const THRESHOLD: f32 = 0.5;

/// calculate ranges that we put into one whisper chunk (usually max 30s)
/// we try to seperate chunks at breaks that are as long as possible
///
/// vad_samples is the raw samples output by the vad
/// max_len is the maximum len of each segment in samples of the vad
pub fn get_chunks(vad_samples: &[f32], sr: f32, max_len: f32, overlap: f32) -> Vec<Range<f32>> {
    let silence_runs = calculate_silence_runs(vad_samples, sr, THRESHOLD);

    let mut chunks: Vec<Range<f32>> = Vec::new();
    let mut pos = 0.0;
    while pos < vad_samples.len() as f32 / sr {
        let mut selected_silence = None;
        for silence in &silence_runs {
            if silence.end <= pos + overlap + 0.00001 {
                continue;
            }
            if silence.end >= pos + max_len {
                break;
            }
            // TODO: do some kind of ranking, maybe we dont want to actually choose the very last
            // silence if it is preceeded by a longer silence before
            selected_silence = Some(silence);
        }
        let chunk = if let Some(silence) = selected_silence {
            pos..silence.end
        } else {
            warn!(
                "Splitting at maximum len at {end} (and not at silence) because no silence was found between {start} and {end}. This is potentially very bad and can cause chunking artifacts!",
                end = format_time(pos + max_len),
                start = format_time(pos)
            );
            pos..pos + max_len
        };
        pos = chunk.end - overlap;
        chunks.push(chunk);
    }

    // TODO: maybe refine the solution to find a globally better optimum (unclear if worth it)
    // TDDO: maybe take into account turn taking here

    chunks
}

pub fn calculate_silence_runs(vad_samples: &[f32], sr: f32, threshold: f32) -> Vec<Range<f32>> {
    let mut runs = Vec::new();
    let mut current_run_start = None;
    let mut energy_on_other_side = 0.0;
    let mut first_on_other_side = None;
    for (i, &sample) in vad_samples.iter().enumerate() {
        if current_run_start.is_none() && sample < threshold {
            energy_on_other_side += (sample - threshold).abs();
            if first_on_other_side.is_none() {
                first_on_other_side = Some(i);
            }
            if energy_on_other_side > 10.0 {
                current_run_start = first_on_other_side;
                energy_on_other_side = 0.0;
                first_on_other_side = None;
            }
        } else if current_run_start.is_some() && sample > threshold {
            energy_on_other_side += (sample - threshold).abs();
            if first_on_other_side.is_none() {
                first_on_other_side = Some(i);
            }
            if energy_on_other_side > 10.0 {
                runs.push(
                    current_run_start.unwrap() as f32 / sr
                        ..first_on_other_side.unwrap() as f32 / sr,
                );
                current_run_start = None;
                energy_on_other_side = 0.0;
                first_on_other_side = None;
            }
        }
    }
    if let Some(start) = current_run_start {
        runs.push(start as f32 / sr..vad_samples.len() as f32 / sr);
    }

    debug!("silence_runs:");
    for s in &runs {
        debug!("\t {} - {}", format_time(s.start), format_time(s.end));
    }

    runs
}
