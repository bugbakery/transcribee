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
use crate::whisper::tree_list::TreeList;
use anyhow::{Ok, Result, bail};
use ndarray::{Array1, Array2, Array3, ArrayView1, Axis, s, stack};
use std::collections::HashMap;
use std::fmt::Debug;
use std::fs::File;
use std::io::Write;
use std::ops::Range;
use std::time::{Duration, Instant};
use tracing::{Level, event, instrument};

pub struct Whisper {
    encoder: DynWhisperEncoderBackend,
    decoder: DynWhisperDecoderBackend,
    tokenizer: Tokenizer,

    beam_width: usize,
    reset_after_x_bars: usize,
    overlap_s: f32,
    max_parallel_chunks: usize,

    beamsearch_early_prune_min_token_conf: f32,
    beamsearch_early_prune_max_decission_postpone: usize,

    startofprev_sequence: Vec<i64>,
    punct_chars: Vec<char>,
}
impl Whisper {
    // idea: make the beam_width only wider if we are unsure about the next token. otherwise greedy is fine
    const MAX_LEN: usize = 448;
    const MAX_CONTEXT_LEN: usize = 50;

    pub fn new(
        encoder: DynWhisperEncoderBackend,
        decoder: DynWhisperDecoderBackend,
        tokenizer: Tokenizer,
        max_parallel_chunks: usize,
    ) -> Result<Self> {
        let mut startofprev_sequence = vec![tokenizer.startofprev()];
        startofprev_sequence.extend_from_slice(&tokenizer.encode("?.,").unwrap());

        let punct_chars = "?!.,".chars().collect();

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
            beam_width: 5,
            reset_after_x_bars: 5,
            overlap_s: 1.0,
            max_parallel_chunks,
            startofprev_sequence,
            punct_chars,
            beamsearch_early_prune_min_token_conf: 0.1,
            beamsearch_early_prune_max_decission_postpone: 10,
        })
    }

    pub fn transcribe(
        &mut self,
        ar: &AudioReader,
        language: Option<String>,
        on_new_bar: &mut dyn FnMut(WhisperBar),
        on_progress: &mut dyn FnMut(f32) -> bool,
    ) -> Result<()> {
        let audio_len_s = ar.len() as f32 / ar.sample_rate();
        let mut timing_helper = TimingHelper::new(audio_len_s);

        // step 1: voice activity detection
        let vad = EarshotVadModel::new(ar)?;
        let chunks = get_chunks(
            &vad.get(0..vad.len())?,
            vad.sample_rate(),
            30.0,
            self.overlap_s,
        );
        timing_helper.num_chunks = chunks.len();

        let mut encoded_chunks = vec![None; chunks.len()];
        let get_encoded_chunk = |whisper: &mut Whisper,
                                 encoded_chunks: &mut Vec<Option<_>>,
                                 chunk_idx: usize,
                                 timing_helper: &mut TimingHelper|
         -> Result<Array2<f32>> {
            if encoded_chunks[chunk_idx].is_none() {
                let chunk = &chunks[chunk_idx];
                let samples = ar.get(
                    (chunk.start * ar.sample_rate()) as usize
                        ..(chunk.end * ar.sample_rate()) as usize,
                )?;
                let start = Instant::now();
                let mel = compute_mel(samples.to_vec())?;
                let mut encoded = whisper.encoder.encode(mel)?;
                timing_helper.encode.push(start.elapsed());

                // mask away the parts that are not enceded (tryout of just running the encoder on smaller chunks)
                // this sometimes breaks the encoder generating eot tokens (baad)
                let mask_start = ((chunk.end - chunk.start) / 30. * 1500.) as usize;
                *encoded.slice_mut(s![mask_start..1500, ..]) *= 0.0;

                encoded_chunks[chunk_idx] = Some(encoded);
            }
            Ok(encoded_chunks[chunk_idx].as_ref().unwrap().clone())
        };

        // step 2: detect language (if unknown)
        let language = if let Some(language) = language {
            language
        } else {
            event!(Level::INFO, "language is not given, detecting language...");
            // we take a non-silence segment from the middle of the text to detect the language
            let encoded = get_encoded_chunk(
                self,
                &mut encoded_chunks,
                chunks.len() / 2,
                &mut timing_helper,
            )?;
            let registered = self.decoder.register_encoded_audio_chunks(&[encoded])?;
            let probs = self.detect_language(&registered)?.remove(0);
            probs[0].0.to_string()
        };
        event!(Level::INFO, "language is {language}");
        if !on_progress(timing_helper.get_progress()) {
            event!(Level::INFO, "transcription job aborted");
            bail!("aborted");
        }

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
        timing_helper.num_decodes = chunk_states
            .iter()
            .map(|state| match state {
                ChunkStates::CanProcessWithoutContext => 2,
                ChunkStates::WaitingForPrevious => 1,
                _ => 0,
            })
            .sum::<usize>()
            - 1;
        let mut outboxed_idx = 0; // how many bars (from the start have we already outboxed?)
        for i in 0usize.. {
            event!(
                Level::DEBUG,
                "chunk states before processing: {:?}",
                chunk_states
            );
            let to_process: Vec<_> = chunk_states
                .iter()
                .enumerate()
                .filter(|(_, x)| x.can_process())
                .take(self.max_parallel_chunks.min(i.saturating_sub(1).max(1)))
                .map(|(i, _)| i)
                .collect();
            if to_process.is_empty() {
                break;
            }
            let mut audio_encoded = vec![];
            for &i in &to_process {
                let encoded = get_encoded_chunk(self, &mut encoded_chunks, i, &mut timing_helper)?;
                audio_encoded.push(encoded);
                if !on_progress(timing_helper.get_progress()) {
                    event!(Level::INFO, "transcription job aborted");
                    bail!("aborted");
                }
            }
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

            let outputs =
                self.transcribe_chunks_with_context(&inputs, &language, &mut timing_helper)?;

            timing_helper.chunks_decoded += outputs.len();
            if !on_progress(timing_helper.get_progress()) {
                event!(Level::INFO, "transcription job aborted");
                bail!("aborted");
            }

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
                    language.clone(),
                    &mut timing_helper,
                )?;
                on_new_bar(bar);
                encoded_chunks[outboxed_idx] = None;
                decoded_chunks[outboxed_idx] = vec![];
                decoded_chunks_again[outboxed_idx] = None;
                outboxed_idx += 1;
            }
        }

        timing_helper.report_stats();
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[instrument(level = Level::TRACE, skip(chunk, chunk_without_context, next_chunk))]
    pub fn select_and_postprocess_transcribed_chunk(
        &mut self,
        chunk_idx: usize,
        chunk_range: Range<f32>,
        chunk: &Vec<SequenceData>,
        chunk_without_context: Option<&Vec<SequenceData>>,
        next_chunk: Option<&Vec<SequenceData>>,
        language: String,
        timing_helper: &mut TimingHelper,
    ) -> Result<WhisperBar> {
        let sequence_data = if let Some(next_chunk) = next_chunk {
            let next_prompts: Vec<_> = next_chunk
                .iter()
                .map(|seq| {
                    let prompt = &seq.tokens[..seq.tokens.len() - seq.new_tokens];
                    let prompt = if prompt.starts_with(&self.startofprev_sequence) {
                        &prompt[self.startofprev_sequence.len()..]
                    } else {
                        prompt
                    };
                    let prompt_without_special: Vec<i64> = prompt
                        .iter()
                        .cloned()
                        .filter(|t| !self.tokenizer.decode_single(*t).unwrap().contains("<|"))
                        .collect();
                    prompt_without_special
                })
                .collect();

            // that all prompts are the same (we enforce this at the end of a bar)
            assert!(next_prompts.iter().all(|prompt| prompt == &next_prompts[0]));

            let next_prompt = &next_prompts[0];

            event!(
                Level::DEBUG,
                chunk_idx,
                "next_prompt: {}",
                self.tokenizer.decode(next_prompt)?
            );

            event!(Level::DEBUG, chunk_idx, "options:");
            for seq in chunk {
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "\t{}",
                    self.tokenizer.decode(&seq.tokens)?
                );
            }

            let exact_match = chunk.iter().find(|seq| seq.tokens.ends_with(next_prompt));
            if let Some(exact_match) = exact_match {
                exact_match.clone()
            } else {
                event!(Level::DEBUG, chunk_idx, "options without context:");
                for seq in chunk_without_context.unwrap() {
                    event!(
                        Level::DEBUG,
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
                                if with_context.tokens.len() > offset_in_with_context
                                    && with_context.tokens[offset_in_with_context + 1..]
                                        .windows(try_prompt.len())
                                        .position(|window| window == try_prompt)
                                        .is_some()
                                {
                                    // the match is not unique, dont strip any further
                                    break;
                                }
                                if try_prompt.len() < 5 {
                                    event!(
                                        Level::WARN,
                                        chunk_idx,
                                        "overlap in gluing bars together is very small {} tokens. the result might be wrong",
                                        try_prompt.len()
                                    );
                                }
                                event!(
                                    Level::INFO,
                                    chunk_idx,
                                    "end_peel={end_peel}, offset_in_with_context={offset_in_with_context}, prompt_offset={prompt_offset}",
                                );
                                break 'search (offset_in_with_context, prompt_offset);
                            }
                        }
                    }

                    event!(
                        Level::ERROR,
                        chunk_idx,
                        "could not fit bars together. this _will_ cause an artifact (taking bar with context)",
                    );
                    (with_context.tokens.len(), next_prompt.len())
                };
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "from with    context: {}",
                    self.tokenizer
                        .decode(&with_context.tokens[..offset_in_with_context])
                        .unwrap()
                );
                let without_context_start =
                    match_without_context.tokens.len() + prompt_offset - next_prompt.len();
                event!(
                    Level::DEBUG,
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
                    with_context.alignment_data.with_elements_removed_from_end(
                        with_context.alignment_data.len() - offset_in_with_context,
                    );

                with_context
                    .tokens
                    .extend_from_slice(&match_without_context.tokens[without_context_start..]);
                with_context
                    .logprobs
                    .extend_from_slice(&match_without_context.logprobs[without_context_start..]);
                for x in &match_without_context
                    .alignment_data
                    .to_vec(without_context_start)
                {
                    with_context.alignment_data =
                        with_context.alignment_data.with_element(x.clone());
                }
                with_context.new_tokens = (with_context.new_tokens as i64
                    + (with_context.len() as i64 - len_before))
                    as usize;
                assert_eq!(with_context.alignment_data.len(), with_context.len());

                with_context
            }
        } else {
            chunk[0].clone()
        };

        self.postprocess_transcribed_chunk(
            chunk_idx,
            chunk_range,
            &sequence_data,
            language,
            timing_helper,
        )
    }

    #[instrument(level = Level::TRACE, skip(chunk))]
    pub fn postprocess_transcribed_chunk(
        &mut self,
        chunk_idx: usize,
        chunk_range: Range<f32>,
        chunk: &SequenceData,
        language: String,
        timing_helper: &mut TimingHelper,
    ) -> Result<WhisperBar> {
        let new_tokens_start = chunk.len() - chunk.new_tokens;
        let alignment = calculate_alignment(
            chunk.alignment_data_concatenated(new_tokens_start - 2),
            ((chunk_range.end - chunk_range.start) * 1500. / 30.) as usize,
        )?;

        timing_helper.output_tokens += chunk.tokens[new_tokens_start..].len();

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

        Ok(WhisperBar { atoms, language })
    }

    /// This function transcribes chunks and prepares the optionally given context for good results
    /// it is basically a wrapper around transcribe_chunks() that does some pre- and postprocessing.
    ///
    /// the resulting beams might be wider than indicated by beam_width, because the most likely
    /// beam copied with tokens stripped from the end to handle audio being cut in the word.
    ///
    /// `x` contains AudioChunks, a vec of possible context sequences that are the starting point
    /// for beam search, and the duration of the context bar
    #[instrument(level = Level::TRACE, skip_all)]
    pub fn transcribe_chunks_with_context(
        &mut self,
        x: &[(usize, AudioChunkHandle, &Vec<SequenceData>, f32)],
        language: &str,
        timing_helper: &mut TimingHelper,
    ) -> Result<Vec<Vec<SequenceData>>> {
        let mut transcribe_chunk_inputs: Vec<(usize, AudioChunkHandle, SequenceLight)> = vec![];
        for (chunk_idx, audio_chunk_handle, initial_beams, last_chunk_duration) in x {
            let mut prompts: SequenceLight = vec![];
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
        let transcribed = self.transcribe_chunks(&transcribe_chunk_inputs, timing_helper)?;

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
                    let mut new_seq = seq.with_x_tokens_removed_from_end(peel);
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
                        new_seq.logprob_sum_normalized()
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

            // force convergence to one prompt at the end of the of the prompt (this is needed so that we have to buffer at most one bar)
            let best_prompt =
                &outputs[0].tokens[..outputs[0].tokens.len() - outputs[0].new_tokens].to_vec();
            outputs.retain(|seq| {
                if &seq.tokens[..seq.tokens.len() - seq.new_tokens] == best_prompt {
                    true
                } else {
                    event!(
                        Level::DEBUG,
                        chunk_idx = x[chunk_idx].0,
                        "{} -> prune (force convergence to one prompt at the end of bar)",
                        self.tokenizer.decode(&seq.tokens).unwrap(),
                    );
                    false
                }
            });

            to_return.push(outputs);
        }
        Ok(to_return)
    }

    /// This function transcribes one chunk of audio with beam search and decides on one concrete
    /// beam. It does not yet do timing reconstruction but only returns the data for that.
    ///
    /// `x` contains AudioChunks and Prompts. Multiple prompts represent multiple beams in beam search.
    /// returns the multiple possible sequences per beam
    #[instrument(level = Level::TRACE, skip_all)]
    pub fn transcribe_chunks(
        &mut self,
        x: &[(usize, AudioChunkHandle, SequenceLight)],
        timing_helper: &mut TimingHelper,
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
                                naive_token_times: vec![],
                                eot_prob: vec![],
                                alignment_data: Default::default(),
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
                .flat_map(|(chunk_idx, (audio, beam))| {
                    if !beam.is_empty() {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "beam width: {}; finished: {}",
                            beam.len(),
                            finished[chunk_idx].len()
                        );
                        timing_helper.beam_widths.push(beam.len());
                    }

                    beam.iter().map(|(seq, _)| (audio.clone(), seq.clone()))
                })
                .collect();
            if decoder_input.is_empty() {
                break;
            }

            let start = Instant::now();
            let (logits, alignment_data) = self.decoder.forward(&decoder_input)?;
            if alignment_data.shape()[2] > 1 {
                timing_helper
                    .prefill
                    .push((start.elapsed(), alignment_data.shape()[0]));
            } else {
                timing_helper
                    .decode
                    .push((start.elapsed(), alignment_data.shape()[0]));
            }

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
                    let token_probs: ArrayView1<f32> =
                        token_probs.slice(s![result_idx, last_token_idx, ..]);

                    let mut new_sequence_data = sequence_data.clone();
                    for i in 0..last_token_idx + 1 {
                        let slice = alignment_data.slice(s![result_idx, .., i, ..]);
                        new_sequence_data.alignment_data = new_sequence_data
                            .alignment_data
                            .with_element(slice.to_owned());

                        // maintain naive token time
                        let softmaxed =
                            softmax(slice.mean_axis(Axis(0)).unwrap().into_dyn(), Axis(0));
                        let mut argmax = 0;
                        let mut max = 0.0;
                        for (i, &x) in softmaxed.iter().enumerate() {
                            if x > max {
                                max = x;
                                argmax = i
                            }
                        }
                        let energy_around = softmaxed
                            .slice(s![
                                argmax.saturating_sub(5)..(argmax + 5).min(softmaxed.len())
                            ])
                            .sum();
                        let argmax_time = argmax as f32 * 30. / 1500.;
                        let last_time = *sequence_data.naive_token_times.last().unwrap_or(&0.0);
                        let naive_token_time = if energy_around > 0.35 && argmax_time > last_time {
                            argmax_time
                        } else {
                            last_time
                        };
                        new_sequence_data.naive_token_times.push(naive_token_time);
                    }
                    new_sequence_data
                        .eot_prob
                        .push(token_probs[self.tokenizer.endoftext() as usize]);
                    new_sequence_data.new_tokens += 1;
                    new_sequence_datas.push(new_sequence_data);

                    let seq_base_logprob = sequence_data.logprob_sum();
                    let seq_len = (&sequence_data.len() + 1) as f32;
                    for (token, &token_prob) in token_probs.iter().enumerate() {
                        let total_logprob = (seq_base_logprob + token_prob.ln()) / seq_len;
                        best.insert(
                            total_logprob,
                            (beam_idx, seq_handle, token as i64, token_prob),
                        );
                    }

                    result_idx += 1;
                }

                let best_score = best.max.max(
                    finished[chunk_idx]
                        .iter()
                        .map(|seq| seq.logprob_sum_normalized())
                        .max_by(|a, b| a.total_cmp(b))
                        .unwrap_or(f32::NEG_INFINITY),
                );
                let best_token_prob = best
                    .data
                    .iter()
                    .map(|x| x.1.3)
                    .max_by(|a, b| a.total_cmp(b))
                    .unwrap_or(0.0);

                for (score, (beam_idx, seq, token, token_prob)) in best.data {
                    let mut next_sequence_data = new_sequence_datas[beam_idx].clone();
                    next_sequence_data.tokens.push(token);
                    next_sequence_data.logprobs.push(token_prob.ln());
                    let next_seq = self.decoder.append_token_to_sequence(seq, token)?;
                    let naive_token_time = *next_sequence_data.naive_token_times.last().unwrap();

                    if token == self.tokenizer.endoftext() {
                        if token_prob > self.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> finished",
                                self.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            finished[chunk_idx].push(next_sequence_data);
                        } else {
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                        }
                    } else if next_sequence_data.len() >= Self::MAX_LEN
                        && finished[chunk_idx].is_empty()
                    {
                        event!(
                            Level::ERROR,
                            chunk_idx = x[chunk_idx].0,
                            "Reached max tokens for decoder. Maybe there was too much text in the bar or maybe the decoder looped. This will cause an artifact eitherway.",
                        );
                        event!(
                            Level::INFO,
                            chunk_idx = x[chunk_idx].0,
                            "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> finished",
                            self.tokenizer.decode(&next_sequence_data.tokens)?,
                        );
                        finished[chunk_idx].push(next_sequence_data);
                    } else if finished[chunk_idx].is_empty() {
                        // we cannot prune all
                        if best_token_prob < self.beamsearch_early_prune_min_token_conf {
                            // all options are shit, we cannot decide now, thus we keep all beams
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> continue (because all are shit)",
                                self.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            next_beam.push((next_seq, next_sequence_data));
                        } else if token_prob > self.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            next_beam.push((next_seq, next_sequence_data));
                        } else {
                            // we prune the beam
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            timing_helper.pruned += 1;
                        }
                    } else {
                        // we could prune all
                        if token_prob > self.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            next_beam.push((next_seq, next_sequence_data));
                        } else {
                            // we prune the beam
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            timing_helper.pruned += 1;
                        }
                    }
                }
                let next_beam_clone = next_beam.clone();
                next_beam.retain(|(_, sequence_data)| {
                    if sequence_data.tokens.len()
                        < self.beamsearch_early_prune_max_decission_postpone
                    {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "{tokens} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> continue",
                            tokens = self.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        timing_helper.not_pruned += 1;
                        return true;
                    };
                    let sibling_tokens = &sequence_data.tokens[sequence_data.tokens.len()
                        - self.beamsearch_early_prune_max_decission_postpone
                        ..sequence_data.tokens.len()];
                    let siblings = next_beam_clone
                        .iter()
                        .map(|(_, sequence_data)| sequence_data)
                        .filter(|candidate| {
                            if candidate.tokens.len()
                                < self.beamsearch_early_prune_max_decission_postpone
                            {
                                return false;
                            };
                            let candidate_sibling_tokens = &candidate.tokens[candidate.tokens.len()
                                - self.beamsearch_early_prune_max_decission_postpone
                                ..candidate.tokens.len()];
                            candidate_sibling_tokens == sibling_tokens
                        });
                    let best_sibling = siblings
                        .max_by(|a, b| {
                            a.logprob_sum_normalized()
                                .total_cmp(&b.logprob_sum_normalized())
                        })
                        .unwrap();
                    let keep = best_sibling.tokens == sequence_data.tokens;
                    if keep {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "{tokens} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> continue",
                            tokens = self.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        timing_helper.not_pruned += 1;
                        true
                    } else {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "{tokens} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (max decision time exceeded)",
                            tokens = self.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        timing_helper.pruned += 1;
                        false
                    }
                });

                next_chunks[chunk_idx].1 = next_beam
            }
            chunks = next_chunks;
        }

        Ok(finished.into_iter().collect())
    }

    /// This function detects the lanuage of the given audio chunks and returns a probability
    /// distribution of (lang, probability) for each chunk
    #[instrument(level = Level::TRACE, skip_all)]
    pub fn detect_language(
        &mut self,
        chunks: &[AudioChunkHandle],
    ) -> Result<Vec<Vec<(&'static str, f32)>>> {
        let len = chunks.len();
        let prompt = self
            .decoder
            .register_sequence(&[self.tokenizer.startoftranscript()]);
        let decoder_input: Vec<_> = chunks
            .iter()
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
            self.min = *self
                .data
                .iter()
                .map(|(score, _)| score)
                .min_by(|a, b| a.total_cmp(b))
                .unwrap();
            if score > self.max {
                self.max = score;
            }
        }
    }
}

type SequenceLight = Vec<(Vec<i64>, Vec<f32>)>;

#[derive(Clone, Default)]
pub struct SequenceData {
    tokens: Vec<i64>,
    logprobs: Vec<f32>,
    naive_token_times: Vec<f32>, // tend to be too low, used to check if transcription is stuck in a loop
    eot_prob: Vec<f32>,
    alignment_data: TreeList<Array2<f32>>, // [heads, audio_len],
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
        let alignment_datas = self.alignment_data.to_vec(context_tokens_skip);

        if alignment_datas.is_empty() {
            Array3::zeros((0, 6, 1500))
        } else {
            stack(
                Axis(0),
                &alignment_datas.iter().map(|x| x.view()).collect::<Vec<_>>(),
            )
            .unwrap()
            .into_owned()
        }
    }

    fn with_x_tokens_removed_from_end(&self, x: usize) -> Self {
        SequenceData {
            tokens: self.tokens[..self.tokens.len() - x].to_vec(),
            logprobs: self.logprobs[..self.logprobs.len() - x].to_vec(),
            naive_token_times: self.naive_token_times[..self.naive_token_times.len() - x].to_vec(),
            eot_prob: self.eot_prob[..self.eot_prob.len() - x].to_vec(),
            alignment_data: self.alignment_data.with_elements_removed_from_end(x - 1),
            new_tokens: self.new_tokens.saturating_sub(x),
        }
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
    pub language: String,
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

#[derive(Debug)]
pub struct TimingHelper {
    start_time: Instant,

    encode: Vec<Duration>,
    prefill: Vec<(Duration, usize)>,
    decode: Vec<(Duration, usize)>,
    chunks_decoded: usize,

    pruned: usize,
    not_pruned: usize,
    beam_widths: Vec<usize>, // to calculate a histogram of beam widths
    output_tokens: usize,

    // stats about the document
    duration: f32,
    num_chunks: usize,
    num_decodes: usize,
}
impl TimingHelper {
    fn new(duration: f32) -> Self {
        TimingHelper {
            start_time: Instant::now(),
            encode: vec![],
            prefill: vec![],
            decode: vec![],
            chunks_decoded: 0,
            pruned: 0,
            not_pruned: 0,
            beam_widths: vec![],
            output_tokens: 0,
            duration,
            num_chunks: 0,
            num_decodes: 0,
        }
    }

    fn get_progress(&self) -> f32 {
        self.encode.len() as f32 / self.num_chunks as f32 * 0.5
            + (self.chunks_decoded as f32 / self.num_decodes as f32) * 0.5
    }

    fn report_stats(&self) {
        let total_duration = self.start_time.elapsed().as_secs_f32();
        event!(
            Level::INFO,
            "transcription of {:.2}s took {total_duration:.2}s ({:.2}x realtime)",
            self.duration,
            self.duration / total_duration,
        );
        let generated_tokens = self.decode.iter().map(|(_, b)| b).sum::<usize>();
        event!(
            Level::INFO,
            "Early pruned {:.1}% of beams. Generated {generated_tokens} tokens, output {} tokens ({02}%)",
            self.pruned as f32 / (self.pruned + self.not_pruned) as f32 * 100.,
            self.output_tokens,
            self.output_tokens as f32 / generated_tokens as f32 * 100.,
        );
        for i in 1..*self.beam_widths.iter().max().unwrap_or(&0) {
            event!(
                Level::INFO,
                "\t beam_width {i}: {:>5.02}%",
                self.beam_widths.iter().filter(|w| **w == i).count() as f32
                    / self.beam_widths.len() as f32
                    * 100.
            );
        }

        let encode_duration: f32 = self.encode.iter().map(|d| d.as_secs_f32()).sum();
        event!(
            Level::INFO,
            "\t encode: {encode_duration:02.2}s ({:02.2}%) runs: {} (mean_duration: {:.02}ms)",
            encode_duration / total_duration * 100.,
            self.encode.len(),
            encode_duration / self.encode.len() as f32 * 1000.
        );

        Self::report_histogram_stats("prefill", &self.prefill, total_duration);
        Self::report_histogram_stats("decode", &self.decode, total_duration);
    }

    fn report_histogram_stats(name: &str, data: &[(Duration, usize)], parent_duration: f32) {
        let self_duration: f32 = data.iter().map(|(d, _)| d.as_secs_f32()).sum();
        let runs_mul_b = data.iter().map(|(_, b)| *b).sum::<usize>();
        event!(
            Level::INFO,
            "\t {name}: {self_duration:.2}s ({:.2}%) runs: {} runs*b: {}",
            self_duration / parent_duration * 100.,
            data.len(),
            runs_mul_b,
        );
        let max_batch_size = data.iter().map(|(_, b)| b).cloned().max().unwrap_or(0);
        for i in 1..max_batch_size + 1 {
            let time_spent: f32 = data
                .iter()
                .filter(|(_, b)| *b == i)
                .map(|(d, _)| d.as_secs_f32())
                .sum();
            let count: usize = data.iter().filter(|(_, b)| *b == i).count();
            if count == 0 {
                continue;
            }
            let mean_duration_per_token = time_spent / (count * i) as f32;
            event!(
                Level::INFO,
                "\t\t b: {i:>2} count: {count:>4} ({percent_calls:>5.02}% of calls; {percent_runs_mul_b:>5.02}% of calls*b) mean_duration/b: {mean_per_token:>6.02}ms time_spent: {time_spent:>6.02}ms ({percent_time:>5.02}% of time)",
                percent_calls = count as f32 / data.len() as f32 * 100.,
                percent_runs_mul_b = (count * i) as f32 / runs_mul_b as f32 * 100.,
                mean_per_token = mean_duration_per_token * 1000.,
                time_spent = time_spent * 1000.0,
                percent_time = time_spent / self_duration * 100.,
            )
        }
    }
}

#[cfg(test)]
mod test {
    use rand::RngExt;

    use crate::whisper::decoder_loop::TopNVec;

    #[test]
    fn test_top_n_vec() {
        let mut top_n_vec = TopNVec::new(5);
        let mut numbers = vec![];

        let mut rng = rand::rng();

        for _ in 0..1000 {
            let v: f32 = rng.random();
            top_n_vec.insert(v.ln() as f32, v);
            numbers.push((v.ln(), v));
        }

        numbers.sort_by(|(a, _), (b, _)| b.total_cmp(a));
        top_n_vec.data.sort_by(|(a, _), (b, _)| b.total_cmp(a));

        assert_eq!(top_n_vec.data, &numbers[..5]);
    }
}
