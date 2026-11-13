//! This file contains the "outer" logic of whisper decoding.
//! I.e. everything that is not backend (the number crunching part) specific.
//! It does stuff like coordinate beamsearch, initiate the word level timestamp reconstruction
//! and feeding audio chunks to the backend. The interface between it and the backend is the
//! WhisperDecoderBackend trait.

use super::decoder::DynWhisperDecoderBackend;
use super::decoder::{AudioChunkHandle, SequenceHandle};
use super::encoder::{DynWhisperEncoderBackend, compute_mel};
use super::math::softmax;
use super::tokenizer::Tokenizer;
use crate::audio_reader::AudioReader;
use crate::vad::chunking::get_chunks;
use crate::vad::earshot::EarshotVadModel;
use crate::whisper::timing::calculate_alignment;
use crate::whisper::tokenizer::{LANGUAGES, NUM_TOKENS};
use anyhow::{Ok, Result};
use ndarray::{Array1, Array2, Array3, Axis, s, stack};
use std::collections::HashMap;
use std::fmt::Debug;
use std::fs::File;
use std::io::Write;
use std::ops::Range;
use std::time::Instant;
use tracing::{Level, event, instrument};

pub struct Whisper {
    encoder: DynWhisperEncoderBackend,
    decoder: DynWhisperDecoderBackend,
    tokenizer: Tokenizer,

    beam_width: usize,
    reset_after_x_bars: usize,
    overlap_s: f32,
    max_parallel_chunks: usize,
    beamsearch_early_prune: f32,

    startofprev_sequence: Vec<i64>,
    punct_chars: Vec<char>,
}
impl Whisper {
    // idea: make the beam_width only wider if we are unsure about the next token. otherwise greedy is fine
    const MAX_LEN: usize = 448;
    const MAX_CONTEXT_LEN: usize = 50;

    pub async fn new(
        encoder: DynWhisperEncoderBackend,
        decoder: DynWhisperDecoderBackend,
        beam_width: usize,
        reset_after_x_bars: usize,
        overlap_s: f32,
        max_parallel_chunks: usize,
        beamsearch_early_prune: f32,
    ) -> Result<Self> {
        let tokenizer = Tokenizer::new().await?;

        let mut startofprev_sequence = vec![tokenizer.startofprev()];
        startofprev_sequence.extend_from_slice(&tokenizer.encode("?.,").unwrap());

        let punct_chars = "?!.,".chars().collect();

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
            beam_width,
            reset_after_x_bars,
            overlap_s,
            max_parallel_chunks,
            startofprev_sequence,
            punct_chars,
            beamsearch_early_prune,
        })
    }

    pub async fn transcribe(
        &mut self,
        ar: &AudioReader,
        language: Option<&str>,
        on_new_bar: &mut dyn FnMut(WhisperBar),
    ) -> Result<()> {
        let start_time = Instant::now();

        // step 1: voice activity detection
        let vad = EarshotVadModel::new(ar).await?;
        let chunks = get_chunks(
            &vad.get(0..vad.len())?,
            vad.sample_rate(),
            30.0,
            self.overlap_s,
        );

        let mut encoded_chunks = vec![None; chunks.len()];
        let mut get_encoded_chunk =
            |encoder: &mut DynWhisperEncoderBackend, chunk_idx: usize| -> Result<Array2<f32>> {
                if encoded_chunks[chunk_idx].is_none() {
                    let chunk = &chunks[chunk_idx];
                    let samples = ar.get(
                        (chunk.start * ar.sample_rate()) as usize
                            ..(chunk.end * ar.sample_rate()) as usize,
                    )?;
                    let mel = compute_mel(samples.to_vec())?;
                    let mut encoded = encoder.encode(mel)?;

                    // mask away the parts that are not enceded (tryout of just running the encoder on smaller chunks)
                    let mask_start = ((chunk.end - chunk.start) / 30. * 1500.) as usize;
                    *encoded.slice_mut(s![mask_start..1500, ..]) *= 0.0;

                    encoded_chunks[chunk_idx] = Some(encoded);
                }
                Ok(encoded_chunks[chunk_idx].as_ref().unwrap().clone())
            };

        // step 2: detect language (if unknown)
        let language = if language.is_none() {
            event!(Level::INFO, "language is not given, detecting language...");
            // we take a non-silence segment from the middle of the text to detect the language
            let encoded = get_encoded_chunk(&mut self.encoder, chunks.len() / 2)?;
            let registered = self.decoder.register_encoded_audio_chunks(&[encoded])?;
            let probs = self.detect_language(&registered)?.remove(0);
            probs[0].0
        } else {
            language.unwrap()
        };
        event!(Level::INFO, "language is {language}");

        #[derive(Debug)]
        enum ChunkStates {
            // example state transition (A = CanProcessWithoutContext, others first letter):
            // AWAW
            // NCWC
            // DNCD
            // DDND
            CanProcessWithoutContext, // the initial state of the context restart points and the first chunk
            WaitingForPrevious,       // initial state of all the other chunks
            CanProcess,               // all dependencies are fulfilled and it can be decoded
            NeedsNextToDecide, // has been decoded but the next chunk will decide which beam is taken (not relevant for last chunk)
            Done,              // has been given to the caller
        }
        impl ChunkStates {
            fn can_process(&self) -> bool {
                matches!(
                    self,
                    ChunkStates::CanProcessWithoutContext | ChunkStates::CanProcess
                )
            }
        }

        // step 3: transcribe chunks
        let mut decoded_chunks: Vec<Vec<SequenceData>> = vec![vec![]; chunks.len()];
        let mut decoded_chunks_again: Vec<Option<Vec<SequenceData>>> = vec![None; chunks.len()];
        let mut chunk_states: Vec<ChunkStates> = (0..chunks.len())
            .map(|i| {
                if i % self.reset_after_x_bars == 0 {
                    ChunkStates::CanProcessWithoutContext
                } else {
                    ChunkStates::WaitingForPrevious
                }
            })
            .collect(); // chunks that have a true here are ready to be processed
        let mut outboxed_idx = 0; // how many bars (from the start have we already outboxed?)
        loop {
            event!(
                Level::INFO,
                "chunk states before processing: {:?}",
                chunk_states
            );
            let to_process: Vec<_> = chunk_states
                .iter()
                .enumerate()
                .filter(|(_, x)| x.can_process())
                .take(self.max_parallel_chunks)
                .map(|(i, _)| i)
                .collect();
            if to_process.is_empty() {
                break;
            }
            let audio_encoded = to_process
                .iter()
                .map(|&i| get_encoded_chunk(&mut self.encoder, i))
                .collect::<Result<Vec<_>>>()?;
            let audio_handles = self.decoder.register_encoded_audio_chunks(&audio_encoded)?;
            let no_context = vec![SequenceData::default()];
            let inputs: Vec<_> = audio_handles
                .into_iter()
                .zip(&to_process)
                .map(|(audio_handle, &chunk_idx)| {
                    let previous = match &chunk_states[chunk_idx] {
                        ChunkStates::CanProcess => &decoded_chunks[chunk_idx - 1],
                        ChunkStates::CanProcessWithoutContext => &no_context,
                        _ => unreachable!(),
                    };
                    let last_chunk_duration = if chunk_idx > 0 {
                        let last_chunk = &chunks[chunk_idx - 1];
                        last_chunk.end - last_chunk.start - self.overlap_s
                    } else {
                        0.0
                    };
                    (chunk_idx, audio_handle, previous, last_chunk_duration)
                })
                .collect();

            let outputs = self.transcribe_chunks_with_context(&inputs, language)?;

            for (i, &chunk_idx) in to_process.iter().enumerate() {
                let path = if matches!(
                    chunk_states[chunk_idx],
                    ChunkStates::CanProcessWithoutContext
                ) {
                    format!("target/chunk_{chunk_idx}_no_context.txt")
                } else {
                    format!("target/chunk_{chunk_idx}.txt")
                };
                let file = &mut File::options()
                    .read(true)
                    .write(true)
                    .truncate(true)
                    .create(true)
                    .open(&path)?;
                writeln!(file, "prompts:")?;
                for seq in inputs[i].2 {
                    let new_tokens_start = seq.len() - seq.new_tokens;
                    let filtered: Vec<i64> = seq.tokens[new_tokens_start..]
                        .iter()
                        .cloned()
                        .filter(|t| !self.tokenizer.decode_single(*t).unwrap().contains("<|"))
                        .collect();

                    writeln!(file, "\t{}", self.tokenizer.decode(&filtered)?)?;
                }
                writeln!(file, "outputs:")?;
                for seq in &outputs[i] {
                    writeln!(file, "\t{}", self.tokenizer.decode(&seq.tokens)?)?;
                }
            }

            for (&chunk_idx, decoded_chunk) in to_process.iter().zip(outputs) {
                if decoded_chunks[chunk_idx].is_empty() {
                    decoded_chunks[chunk_idx] = decoded_chunk;
                } else {
                    decoded_chunks_again[chunk_idx] = Some(decoded_chunk)
                }
                match chunk_states[chunk_idx] {
                    ChunkStates::CanProcessWithoutContext => {
                        if chunk_idx != chunks.len() - 1
                            && matches!(
                                chunk_states[chunk_idx + 1],
                                ChunkStates::WaitingForPrevious
                            )
                        {
                            chunk_states[chunk_idx + 1] = ChunkStates::CanProcess;
                        }
                        if chunk_idx == 0 {
                            if chunk_idx == chunks.len() - 1 {
                                chunk_states[chunk_idx] = ChunkStates::Done;
                            } else {
                                chunk_states[chunk_idx] = ChunkStates::NeedsNextToDecide;
                            }
                        } else if let ChunkStates::NeedsNextToDecide = chunk_states[chunk_idx - 1] {
                            chunk_states[chunk_idx] = ChunkStates::CanProcess;
                        } else {
                            chunk_states[chunk_idx] = ChunkStates::WaitingForPrevious;
                        }
                    }
                    ChunkStates::CanProcess => {
                        if let ChunkStates::NeedsNextToDecide = chunk_states[chunk_idx - 1] {
                            chunk_states[chunk_idx - 1] = ChunkStates::Done;
                        }

                        if chunk_idx == chunks.len() - 1 {
                            chunk_states[chunk_idx] = ChunkStates::Done;
                        } else if let ChunkStates::Done | ChunkStates::NeedsNextToDecide =
                            chunk_states[chunk_idx + 1]
                        {
                            chunk_states[chunk_idx] = ChunkStates::Done;
                        } else {
                            chunk_states[chunk_idx] = ChunkStates::NeedsNextToDecide;
                        }

                        if chunk_idx != chunks.len() - 1
                            && matches!(
                                chunk_states[chunk_idx + 1],
                                ChunkStates::WaitingForPrevious
                            )
                        {
                            chunk_states[chunk_idx + 1] = ChunkStates::CanProcess;
                        }
                    }
                    _ => unreachable!(),
                }
            }

            while outboxed_idx < chunk_states.len()
                && matches!(chunk_states[outboxed_idx], ChunkStates::Done)
            {
                let bar = self.select_and_postprocess_transcribed_chunk(
                    outboxed_idx,
                    chunks[outboxed_idx].clone(),
                    decoded_chunks_again[outboxed_idx]
                        .as_ref()
                        .unwrap_or(&decoded_chunks[outboxed_idx]),
                    decoded_chunks_again[outboxed_idx]
                        .as_ref()
                        .map(|_| &decoded_chunks[outboxed_idx]),
                    if outboxed_idx < chunks.len() - 1 {
                        decoded_chunks_again[outboxed_idx + 1]
                            .as_ref()
                            .or(decoded_chunks.get(outboxed_idx + 1))
                    } else {
                        None
                    },
                )?;
                on_new_bar(bar);
                outboxed_idx += 1;
            }
        }

        let audio_len_s = ar.len() as f32 / ar.sample_rate();
        let duration = start_time.elapsed().as_secs_f32();
        println!(
            "transcription of {audio_len_s:.2}s took {duration:.2}s ({:.2}x realtime)",
            audio_len_s / duration
        );
        Ok(())
    }

    #[instrument(skip(chunk, chunk_without_context, next_chunk))]
    pub fn select_and_postprocess_transcribed_chunk(
        &self,
        chunk_idx: usize,
        chunk_range: Range<f32>,
        chunk: &Vec<SequenceData>,
        chunk_without_context: Option<&Vec<SequenceData>>,
        next_chunk: Option<&Vec<SequenceData>>,
    ) -> Result<WhisperBar> {
        let sequence_data = if let Some(next_chunk) = next_chunk {
            let next_prompts: Vec<_> = next_chunk
                .iter()
                .map(|seq| {
                    let prompt = &seq.tokens[..seq.tokens.len() - seq.new_tokens];
                    let prompt = if prompt.starts_with(&self.startofprev_sequence) {
                        &prompt[self.startofprev_sequence.len()..]
                    } else {
                        &prompt
                    };
                    let prompt_without_special: Vec<i64> = prompt
                        .iter()
                        .cloned()
                        .filter(|t| !self.tokenizer.decode_single(*t).unwrap().contains("<|"))
                        .collect();
                    prompt_without_special
                })
                .collect();
            if !next_prompts.iter().all(|prompt| prompt == &next_prompts[0]) {
                event!(
                    Level::WARN,
                    chunk_idx,
                    "the prompts for the next bar have not converged. Next prompts (taking first):",
                );
                for prompt in &next_prompts {
                    event!(
                        Level::WARN,
                        chunk_idx,
                        "\t{}",
                        self.tokenizer.decode(&prompt)?
                    )
                }
            }
            let next_prompt = &next_prompts[0];

            event!(Level::INFO, chunk_idx, "options:");
            for seq in chunk {
                event!(
                    Level::INFO,
                    chunk_idx,
                    "\t{}",
                    self.tokenizer.decode(&seq.tokens)?
                );
            }
            event!(Level::INFO, chunk_idx, "next_prompts:");
            for prompt in &next_prompts {
                event!(
                    Level::INFO,
                    chunk_idx,
                    "\t{}",
                    self.tokenizer.decode(&prompt)?
                );
            }

            let exact_match = chunk.iter().find(|seq| seq.tokens.ends_with(next_prompt));
            if let Some(exact_match) = exact_match {
                exact_match.clone()
            } else {
                event!(Level::INFO, chunk_idx, "options without context:");
                for seq in chunk_without_context.unwrap() {
                    event!(
                        Level::INFO,
                        chunk_idx,
                        "\t{}",
                        self.tokenizer.decode(&seq.tokens)?
                    );
                }

                event!(
                    Level::WARN,
                    chunk_idx,
                    "The transcription with context did not fit the next bar. Frankensteining together a new bar that fits..."
                );
                let match_without_context: &SequenceData = chunk_without_context
                    .unwrap()
                    .iter()
                    .find(|seq| seq.tokens.ends_with(next_prompt))
                    .unwrap();
                let mut with_context = chunk[0].clone();
                let (offset_in_with_context, prompt_offset) = 'search: {
                    for end_peel in 0..next_prompt.len().div_ceil(2) {
                        let next_prompt = &next_prompt[..next_prompt.len() - end_peel];
                        for prompt_offset in 0..next_prompt.len() {
                            let try_prompt = &next_prompt[prompt_offset..];
                            if let Some(offset_in_with_context) = with_context
                                .tokens
                                .windows(try_prompt.len())
                                .position(|window| window == try_prompt)
                            {
                                break 'search (offset_in_with_context, prompt_offset);
                            }
                        }
                    }

                    event!(
                        Level::ERROR,
                        chunk_idx,
                        "could not fit bars together. this _will_ cause an artifact",
                    );
                    (0, next_prompt.len())
                };
                event!(
                    Level::INFO,
                    chunk_idx,
                    "from with    context: {}",
                    self.tokenizer
                        .decode(&with_context.tokens[..offset_in_with_context])
                        .unwrap()
                );
                let without_context_start =
                    match_without_context.tokens.len() + prompt_offset - next_prompt.len();
                event!(
                    Level::INFO,
                    chunk_idx,
                    "from without context: {}",
                    self.tokenizer
                        .decode(&match_without_context.tokens[without_context_start..])
                        .unwrap()
                );

                let len_before = with_context.len() as i64;
                with_context.tokens = with_context.tokens[..offset_in_with_context].to_vec();
                with_context.logprobs = with_context.logprobs[..offset_in_with_context].to_vec();
                with_context.alignment_data =
                    with_context.alignment_data[..offset_in_with_context].to_vec();

                with_context
                    .tokens
                    .extend_from_slice(&match_without_context.tokens[without_context_start..]);
                with_context
                    .logprobs
                    .extend_from_slice(&match_without_context.logprobs[without_context_start..]);
                with_context.alignment_data.extend_from_slice(
                    &match_without_context.alignment_data[without_context_start..],
                );
                with_context.new_tokens = (with_context.new_tokens as i64
                    + (with_context.len() as i64 - len_before))
                    as usize;

                with_context
            }
        } else {
            chunk[0].clone()
        };

        self.postprocess_transcribed_chunk(chunk_idx, chunk_range, &sequence_data)
    }

    #[instrument(skip(chunk))]
    pub fn postprocess_transcribed_chunk(
        &self,
        chunk_idx: usize,
        chunk_range: Range<f32>,
        chunk: &SequenceData,
    ) -> Result<WhisperBar> {
        let new_tokens_start = chunk.len() - chunk.new_tokens;
        let alignment = calculate_alignment(
            chunk.alignment_data_concatenated(new_tokens_start - 2),
            ((chunk_range.end - chunk_range.start) * 1500. / 30.) as usize,
        )?;

        let atoms: Vec<_> = chunk.tokens[new_tokens_start..]
            .iter()
            .enumerate()
            .map(|(i, token)| Atom {
                conf: chunk.logprobs[new_tokens_start + i].exp(),
                conf_ts: 1.0,
                start: alignment[i + 1] as f32 / 1500. * 30. + chunk_range.start,
                end: alignment[i + 2] as f32 / 1500. * 30. + chunk_range.start,
                text: self.tokenizer.decode_single(*token).unwrap(),
            })
            .collect();

        Ok(WhisperBar { atoms })
    }

    /// This function transcribes chunks and prepares the optionally given context for good results
    /// it is basically a wrapper around transcribe_chunks() that does some pre- and postprocessing.
    ///
    /// the resulting beams might be wider than indicated by beam_width, because the most likely
    /// beam copied with tokens stripped from the end to handle audio being cut in the word.
    ///
    /// `x` contains AudioChunks, a vec of possible context sequences that are the starting point
    /// for beam search, and the duration of the context bar
    #[instrument(skip_all)]
    pub fn transcribe_chunks_with_context(
        &mut self,
        x: &[(usize, AudioChunkHandle, &Vec<SequenceData>, f32)],
        language: &str,
    ) -> Result<Vec<Vec<SequenceData>>> {
        let mut transcribe_chunk_inputs: Vec<(usize, AudioChunkHandle, Vec<(Vec<i64>, Vec<f32>)>)> =
            vec![];
        for (chunk_idx, audio_chunk_handle, initial_beams, last_chunk_duration) in x {
            let mut prompts: Vec<(Vec<i64>, Vec<f32>)> = vec![];
            for seq in initial_beams.iter() {
                let mut tokens = vec![];
                let mut logprobs = vec![];
                let context_tokens_start = seq.new_tokens.saturating_sub(Self::MAX_CONTEXT_LEN)
                    + (seq.len() - seq.new_tokens);
                let context_tokens = &seq.tokens[context_tokens_start..];

                // fill context from the provided last sequences
                if !context_tokens.is_empty() {
                    tokens.extend_from_slice(&self.startofprev_sequence);
                    logprobs.extend_from_slice(&vec![0.0; self.startofprev_sequence.len()]);

                    // put tokens that are in the overlap to the right of the sot sequence, others to the left
                    let last_chunk_last_audio_idx = (last_chunk_duration / 30. * 1500.) as usize;
                    let alignment = seq
                        .alignment_data_concatenated(
                            seq.alignment_data.len() - context_tokens.len() - 1,
                        )
                        .mean_axis(Axis(1))
                        .unwrap();
                    let alignment: Array2<f32> = softmax(alignment.into_dyn(), Axis(1))
                        .into_dimensionality()
                        .unwrap();
                    let mut leftmost_on_right = 'search: {
                        for i in (1..context_tokens.len()).rev() {
                            let energy_in_last_chunk =
                                alignment.slice(s![i, last_chunk_last_audio_idx..]).sum();
                            if energy_in_last_chunk < 0.5 {
                                break 'search i + 1;
                            }
                        }
                        context_tokens.len()
                    };

                    if seq.tokens[context_tokens_start + leftmost_on_right..].len() == 1
                        && self.punct_chars.iter().any(|c| {
                            self.tokenizer
                                .decode_single(seq.tokens[seq.tokens.len() - 1])
                                .unwrap()
                                .contains(*c)
                        })
                    {
                        leftmost_on_right += 1;
                    }

                    tokens.extend_from_slice(
                        &seq.tokens[context_tokens_start..context_tokens_start + leftmost_on_right],
                    );
                    logprobs.extend_from_slice(
                        &seq.logprobs
                            [context_tokens_start..context_tokens_start + leftmost_on_right],
                    );

                    let sot_sequence = &self.tokenizer.sot_sequence(language).unwrap();
                    tokens.extend_from_slice(sot_sequence);
                    logprobs.extend_from_slice(&vec![0.0; sot_sequence.len()]);

                    tokens
                        .extend_from_slice(&seq.tokens[context_tokens_start + leftmost_on_right..]);
                    logprobs.extend_from_slice(
                        &seq.logprobs[context_tokens_start + leftmost_on_right..],
                    );
                } else {
                    let sot_sequence = &self.tokenizer.sot_sequence(language).unwrap();
                    tokens.extend_from_slice(sot_sequence);
                    logprobs.extend_from_slice(&vec![0.0; sot_sequence.len()]);
                }

                prompts.push((tokens.clone(), logprobs));
            }

            event!(Level::DEBUG, chunk_idx, "prompts:");
            for prompt in &prompts {
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "\t{}",
                    self.tokenizer.decode(&prompt.0).unwrap()
                )
            }
            transcribe_chunk_inputs.push((*chunk_idx, audio_chunk_handle.clone(), prompts));
        }

        // TODO: detect common prefixes and only prefill once. this might save a lot of compute
        let transcribed = self.transcribe_chunks(&transcribe_chunk_inputs)?;

        let mut to_return = vec![];
        for (chunk_idx, mut beams) in transcribed.into_iter().enumerate() {
            beams.sort_by(|a, b| {
                b.logprob_sum_normalized_new_tokens()
                    .total_cmp(&a.logprob_sum_normalized())
            });

            for (i, beam) in beams.iter().enumerate() {
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "beam #{}: {} {} ({} new tokens)",
                    i,
                    self.tokenizer
                        .decode(&beam.tokens[beam.tokens.len() - beam.new_tokens..])
                        .unwrap(),
                    beam.logprob_sum_normalized_new_tokens(),
                    beam.new_tokens,
                );
            }

            let mut outputs = vec![];
            for (i, seq) in beams.iter().enumerate() {
                let mut add_sequence = |peel: usize, last_token_penalty: f32| {
                    let mut new_seq = SequenceData {
                        tokens: seq.tokens[..seq.tokens.len() - peel].to_vec(),
                        logprobs: seq.logprobs[..seq.logprobs.len() - peel].to_vec(),
                        alignment_data: seq.alignment_data[..seq.len() - peel].to_vec(),
                        new_tokens: seq.new_tokens.saturating_sub(peel),
                    };
                    let new_seq_len = new_seq.len();
                    if new_seq_len > 0 {
                        new_seq.logprobs[new_seq_len - 1] += last_token_penalty.ln();
                    }
                    event!(
                        Level::DEBUG,
                        chunk_idx,
                        "\t {} {}",
                        self.tokenizer
                            .decode(&seq.tokens[..seq.len() - peel])
                            .unwrap(),
                        new_seq.logprob_sum_normalized().exp()
                    );
                    outputs.push(new_seq);
                };

                // only remove EOT token
                add_sequence(1, 1.0);

                // peel of one token of the most likely sequence if it is a sentence sign
                if i == 0 && seq.new_tokens > 2 {
                    let last_token_str = self
                        .tokenizer
                        .decode_single(seq.tokens[seq.tokens.len() - 2])
                        .unwrap();
                    if self.punct_chars.iter().any(|c| last_token_str.contains(*c)) {
                        add_sequence(2, 0.9);
                    }
                }

                // peel of one word of the most likely sequence
                // (because the last word is sometimes bullshit when it is cut of in the middle)
                if i == 0 {
                    let mut peel = 2;
                    while seq.new_tokens > peel {
                        if self
                            .tokenizer
                            .decode_single(seq.tokens[seq.tokens.len() - peel])
                            .unwrap()
                            .starts_with(" ")
                        {
                            break;
                        }
                        peel += 1;
                    }
                    if seq.new_tokens > peel {
                        add_sequence(peel, 0.5 / peel as f32);
                    }
                }
            }
            let best_mean_logprob = outputs
                .iter()
                .map(|seq| seq.logprob_sum_normalized())
                .max_by(|a, b| a.total_cmp(b))
                .unwrap();
            outputs.retain(|seq| !self.should_early_prune(best_mean_logprob, seq));

            to_return.push(outputs);
        }
        Ok(to_return)
    }

    /// This function transcribes one chunk of audio with beam search and decides on one concrete
    /// beam. It does not yet do timing reconstruction but only returns the data for that.
    ///
    /// `x` contains AudioChunks and Prompts. Multiple prompts represent multiple beams in beam search.
    /// returns the multiple possible sequences per beam
    #[instrument(skip_all)]
    pub fn transcribe_chunks(
        &mut self,
        x: &[(usize, AudioChunkHandle, Vec<(Vec<i64>, Vec<f32>)>)],
    ) -> Result<Vec<Vec<SequenceData>>> {
        let mut chunks: Vec<(AudioChunkHandle, Vec<(SequenceHandle, SequenceData)>)> = Vec::new();
        for (_chunk_idx, audio, prompts) in x {
            chunks.push((
                audio.clone(),
                prompts
                    .iter()
                    .map(|(prompt, logprobs)| {
                        (
                            self.decoder.register_sequence(prompt),
                            SequenceData {
                                tokens: prompt.to_vec(),
                                logprobs: logprobs.to_vec(),
                                alignment_data: vec![],
                                new_tokens: 0,
                            },
                        )
                    })
                    .collect::<Vec<_>>(),
            ));
        }

        let mut finished: Vec<Vec<SequenceData>> = vec![vec![]; x.len()];
        for i in 0.. {
            let decoder_input: Vec<_> = chunks
                .iter()
                .enumerate()
                .filter(|&(chunk_idx, _)| finished[chunk_idx].len() < self.beam_width)
                .flat_map(|(_, (audio, beam))| {
                    beam.iter().map(|(seq, _)| (audio.clone(), seq.clone()))
                })
                .collect();
            if decoder_input.is_empty() {
                break;
            }

            let (logits, alignment_data) = self.decoder.forward(&decoder_input)?;

            let nospeech = &[self.tokenizer.nospeech()];
            let nospeech_and_endoftext = &[self.tokenizer.endoftext(), self.tokenizer.nospeech()];
            let mask = if false {
                // as the first token, we extrude a timestamp token with a certain maximum time
                let mut mask = Array1::zeros(NUM_TOKENS);
                for i in 0..NUM_TOKENS {
                    mask[i] = f32::NEG_INFINITY;
                }
                for time in self.tokenizer.encode_single("<|0.00|>").unwrap()
                    ..self.tokenizer.encode_single("<|1.00|>").unwrap()
                {
                    mask[time as usize] = 0.0;
                }
                mask
            } else {
                self.tokenizer.special_tokens_mask(if i == 0 {
                    nospeech
                } else {
                    nospeech_and_endoftext
                }) + self.tokenizer.non_speech_tokens_mask()
            };
            let result = logits + mask;
            let last_axis = Axis(result.shape().len() - 1);
            let token_probs: Array3<f32> = softmax(result.into_dyn(), last_axis)
                .into_dimensionality()
                .unwrap();

            let mut next_chunks = chunks.clone();
            let mut result_idx = 0;
            for (chunk_idx, (_audio, beam)) in chunks.iter().enumerate() {
                if finished[chunk_idx].len() >= self.beam_width {
                    continue;
                }
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(usize, &SequenceHandle, i64, f32)> =
                    TopNVec::new(self.beam_width);
                let mut new_sequence_datas = vec![];
                for (beam_idx, (seq_handle, sequence_data)) in beam.iter().enumerate() {
                    let last_token_idx = if i == 0 { sequence_data.len() - 1 } else { 0 };
                    let token_probs = token_probs.slice(s![result_idx, last_token_idx, ..]);

                    let mut new_sequence_data = sequence_data.clone();
                    for i in 0..last_token_idx + 1 {
                        new_sequence_data
                            .alignment_data
                            .push(alignment_data.slice(s![result_idx, .., i, ..]).to_owned());
                    }
                    new_sequence_data.new_tokens += 1;
                    new_sequence_datas.push(new_sequence_data);

                    let seq_base_logprob = sequence_data.logprob_sum();
                    let seq_len = (&sequence_data.len() + 1) as f32;
                    for (token, &prob) in token_probs.iter().enumerate() {
                        let total_logprob = (seq_base_logprob + prob.ln()) / seq_len;
                        best.insert(total_logprob, (beam_idx, seq_handle, token as i64, prob));
                    }

                    result_idx += 1;
                }

                for (score, (beam_idx, seq, token, conf)) in best.data {
                    let mut next_sequence_data = new_sequence_datas[beam_idx].clone();
                    next_sequence_data.tokens.push(token);
                    next_sequence_data.logprobs.push(conf.ln());
                    let next_seq = self.decoder.append_token_to_sequence(seq, token)?;

                    event!(
                        Level::TRACE,
                        chunk_idx = x[chunk_idx].0,
                        "{} {}",
                        self.tokenizer.decode(&next_sequence_data.tokens)?,
                        score.exp()
                    );

                    if token as i64 == self.tokenizer.endoftext()
                        || next_sequence_data.len() >= Self::MAX_LEN
                    {
                        finished[chunk_idx].push(next_sequence_data);
                    } else if !self.should_early_prune(best.max, &next_sequence_data) {
                        next_beam.push((next_seq, next_sequence_data));
                    }
                }
                next_chunks[chunk_idx].1 = next_beam
            }
            chunks = next_chunks;
        }

        Ok(finished.into_iter().map(|x| x).collect())
    }

    /// determines if we should early prune a beam from the beamsearch.
    /// the beamsearch_early_prune parameter basically asks: how many tokens with the best probability (1.0) are we allowed to imaginarily
    /// add to make the beam better than the best. If the beam with beamsearch_early_prune tokens is not better than the best, we prune it.
    /// beamsearch_early_prune can be a fractional number.
    fn should_early_prune(&self, best_mean_logprob: f32, seq: &SequenceData) -> bool {
        (seq.logprob_sum() + 1.0f32.ln() * self.beamsearch_early_prune)
            / (seq.len() as f32 + self.beamsearch_early_prune)
            < best_mean_logprob
    }

    /// This function detects the lanuage of the given audio chunks and returns a probability
    /// distribution of (lang, probability) for each chunk
    #[instrument(skip_all)]
    pub fn detect_language(
        &mut self,
        chunks: &[AudioChunkHandle],
    ) -> Result<Vec<Vec<(&'static str, f32)>>> {
        let len = chunks.len();
        let prompt = self
            .decoder
            .register_sequence(&[self.tokenizer.startoftranscript()]);
        let decoder_input: Vec<_> = chunks
            .into_iter()
            .map(|chunk| (chunk.clone(), prompt.clone()))
            .collect();
        let (logits, _alignment_data) = self.decoder.forward(&decoder_input)?;

        let language_tokens = LANGUAGES
            .iter()
            .map(|(code, _)| Ok((self.tokenizer.encode_single(&format!("<|{code}|>"))?, *code)))
            .collect::<Result<HashMap<_, _>>>()?;
        let mask = self
            .tokenizer
            .generate_mask(|t| language_tokens.contains_key(&t));

        Ok((0..len)
            .map(|b| {
                let distribution = softmax(
                    logits.slice(s![b, 0, ..]).to_owned() + mask.clone().into_dyn(),
                    Axis(0),
                );
                let mut with_prob: Vec<(&str, f32)> = language_tokens
                    .iter()
                    .map(|(token, code)| (*code, distribution[*token as usize]))
                    .collect();
                with_prob.sort_by(|(_, a), (_, b)| b.total_cmp(a));
                with_prob
            })
            .collect())
    }
}
impl Debug for Whisper {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Whisper")
            .field("beam_width", &self.beam_width)
            .field("reset_after_x_bars", &self.reset_after_x_bars)
            .field("overlap_s", &self.overlap_s)
            .field("max_parallel_chunks", &self.max_parallel_chunks)
            .field("startofprev_sequence", &self.startofprev_sequence)
            .finish_non_exhaustive()
    }
}

/// A datastructure that only stores the top N entries
#[derive(Debug)]
pub struct TopNVec<T> {
    pub n: usize,
    pub min: f32,
    pub max: f32,
    pub data: Vec<(f32, T)>,
}
impl<T> TopNVec<T> {
    fn new(n: usize) -> Self {
        Self {
            n,
            min: f32::INFINITY,
            max: f32::NEG_INFINITY,
            data: Vec::new(),
        }
    }

    fn insert(&mut self, score: f32, value: T) {
        if self.data.len() < self.n {
            self.data.push((score, value));
            self.min = self.min.min(score);
        } else if score > self.min {
            let current_min_idx = self
                .data
                .iter()
                .enumerate()
                .min_by(|(_, (a, _)), (_, (b, _))| a.total_cmp(b))
                .unwrap()
                .0;
            self.data[current_min_idx] = (score, value);
            self.min = score;
            if score > self.max {
                self.max = score;
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct SequenceData {
    tokens: Vec<i64>,
    logprobs: Vec<f32>,
    alignment_data: Vec<Array2<f32>>, // [heads, audio_len]
    new_tokens: usize,
}
impl SequenceData {
    pub fn len(&self) -> usize {
        assert_eq!(self.tokens.len(), self.logprobs.len());
        self.tokens.len()
    }

    pub fn logprob_sum(&self) -> f32 {
        self.logprobs.iter().sum()
    }

    pub fn logprob_sum_normalized(&self) -> f32 {
        self.logprob_sum() / self.len() as f32
    }

    pub fn logprob_sum_normalized_new_tokens(&self) -> f32 {
        self.logprobs[self.logprobs.len() - self.new_tokens..]
            .iter()
            .sum::<f32>()
            / self.new_tokens as f32
    }

    pub fn alignment_data_concatenated(&self, context_tokens_skip: usize) -> Array3<f32> {
        stack(
            Axis(0),
            &self.alignment_data[context_tokens_skip..]
                .iter()
                .map(|x| x.view())
                .collect::<Vec<_>>(),
        )
        .unwrap()
        .into_owned()
    }
}
impl Debug for SequenceData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SequenceData")
            .field("tokens", &self.tokens)
            .field("logprobs", &self.logprobs)
            .field("new_tokens", &self.new_tokens)
            .finish_non_exhaustive()
    }
}

pub struct WhisperBar {
    pub atoms: Vec<Atom>,
}
impl WhisperBar {
    pub fn as_string(&self) -> String {
        let mut to_return = String::new();
        for a in &self.atoms {
            to_return.push_str(&a.text);
        }
        to_return
    }
    pub fn as_json(&self) -> String {
        let mut to_return = "[\n".to_string();
        for atom in &self.atoms {
            to_return += &atom.as_json();
            to_return += ",\n";
        }
        to_return += "]";
        to_return
    }
}

#[derive(Debug)]
pub struct Atom {
    pub conf: f32,
    pub conf_ts: f32,
    pub start: f32,
    pub end: f32,
    pub text: String,
}
impl Atom {
    fn as_json(&self) -> String {
        format!(
            "{{ \"text\": \"{}\", \"start\": {}, \"end\": {}, \"conf\": {}, \"conf_ts\": {} }}",
            self.text, self.start, self.end, self.conf, self.conf_ts,
        )
    }
}
