use log::debug;
use std::ops::Range;

// TODO: this probably wants to live in the VAD code as it is VAD engine specific
const THRESHOLD: f32 = 0.5;

/// calculate points at which it is smart to restart the transcription.
/// we aim to make the chunks similiar-sized and not in the middle of some speech
pub fn get_restart_points(vad_samples: &[f32], target_len: usize) -> Vec<usize> {
    let silence_runs = calculate_silence_runs(vad_samples);

    let mut split_points: Vec<usize> = Vec::new();
    loop {
        let last_start = split_points
            .last()
            .map(|idx| silence_runs[*idx].end)
            .unwrap_or(0);
        if vad_samples.len() - last_start <= target_len * 3 / 2 {
            break;
        }
        if let Some(next) = choose_next_silence(&silence_runs, last_start, target_len) {
            split_points.push(next);
        } else {
            break;
        };
    }

    // TODO: maybe refine the solution to find a globally better optimum (unclear if worth it)
    // TDDO: maybe take into account turn taking here

    split_points
        .iter()
        .map(|idx| silence_runs[*idx].end)
        .collect()
}

// picks the next best silence for splitting according to a metric
// returns the index of the picked silence into the silence_runs array
// last_start is the time in chunks and target_len is the target duration in chunks
fn choose_next_silence(
    silence_runs: &[Range<usize>],
    last_start: usize,
    target_len: usize,
) -> Option<usize> {
    let mut best = None;
    debug!("\n\n\nchoose_next_silence last_start={last_start}");
    for (i, silence) in silence_runs.iter().enumerate() {
        if last_start >= silence.end {
            continue;
        }
        let silence_len: usize = silence.end - silence.start;
        let off_from_target = (last_start as f64 + target_len as f64 - silence.start as f64).abs()
            / target_len as f64;
        let score = -off_from_target + (silence_len as f64 + 1.0).log2();
        debug!(
            "silence len={} off={} score={score}",
            silence_len as f32 / 31.25,
            off_from_target as f32 * 3.0 * 60.0
        );
        if let Some((_, best_score)) = best {
            if score > best_score {
                best = Some((i, score));
            }
        } else {
            best = Some((i, score));
        }
    }
    if let Some((idx, score)) = best {
        let silence = &silence_runs[idx];
        let silence_len: usize = silence.end - silence.start;
        let off_from_target = (last_start as f64 + target_len as f64 - silence.start as f64).abs()
            / target_len as f64;

        debug!(
            "-> silence len={} off={} score={score}",
            silence_len as f32 / 31.25,
            off_from_target as f32 * 3.0 * 60.0
        );
    }
    best.map(|(idx, score)| idx)
}

fn calculate_silence_runs(vad_samples: &[f32]) -> Vec<Range<usize>> {
    let mut runs = Vec::new();
    let mut current_run_start = None;
    for (i, sample) in vad_samples.iter().enumerate() {
        if current_run_start.is_none() && *sample < THRESHOLD {
            current_run_start = Some(i);
        } else if current_run_start.is_some() && *sample > THRESHOLD {
            runs.push(current_run_start.unwrap()..i);
            current_run_start = None;
        }
    }
    if let Some(start) = current_run_start {
        runs.push(start..vad_samples.len());
    }
    runs
}

#[cfg(test)]
mod test {
    use crate::{audio_reader::AudioReader, silero_vad::SileroVadModel};

    use super::*;

    #[tokio::test]
    async fn test_smoke() {
        let ar =
            AudioReader::new("/Users/anuejn/Downloads/merely transcription making & doing.m4a")
                .unwrap();
        let vad = SileroVadModel::new(ar).await.unwrap();
        let target_len_mins = 3.0;
        let target_len_vad_blocks = (vad.sample_rate() * target_len_mins * 60.0) as usize;
        let restart_points =
            get_restart_points(&vad.get(0..vad.len()).unwrap(), target_len_vad_blocks);
        for point in &restart_points {
            let secs = *point as f32 / vad.sample_rate();
            let mins = (secs / 60.0) as usize;
            let rem_secs = secs - (mins as f32 * 60.0);
            println!("{mins}:{rem_secs}");
        }
        assert_eq!(restart_points.len(), 4)
    }
}
