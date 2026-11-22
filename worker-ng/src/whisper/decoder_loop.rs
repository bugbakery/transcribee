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
use crate::whisper::timing::{calculate_alignment, preprocess_alignment_data};
use crate::whisper::tokenizer::{LANGUAGES, NUM_TOKENS};
use crate::whisper::tree_list::TreeList;
use anyhow::{Ok, Result, bail};
use ndarray::{Array1, Array2, Array3, Axis, s, stack};
use sentencex::segment;
use std::char;
use std::collections::HashMap;
use std::fmt::Debug;
use std::ops::Range;
use std::time::{Duration, Instant};
use tracing::{Level, event, instrument};

pub struct WhisperModel {
    encoder: DynWhisperEncoderBackend,
    decoder: DynWhisperDecoderBackend,
    tokenizer: Tokenizer,

    beam_width: usize,
    reset_after_x_bars: usize,
    overlap_s: f32,
    max_parallel_chunks: usize,

    beamsearch_early_prune_min_token_conf: f32,
    beamsearch_early_prune_max_decission_postpone: usize,
    max_tokens_without_timing_progress: usize,

    startofprev_sequence: Vec<i64>,
    punct_chars: Vec<char>,
    punct_tokens: Vec<i64>,
    nudge_towards_punct_delay: usize,
    nudge_towards_punct_rate: f32,

    enable_sentence_combiner: bool,
}
impl WhisperModel {
    const MAX_DECODER_TOKENS: usize = 448;
    const MAX_CONTEXT_LEN: usize = 50;

    pub fn new(
        encoder: DynWhisperEncoderBackend,
        decoder: DynWhisperDecoderBackend,
        tokenizer: Tokenizer,
        max_parallel_chunks: usize,
    ) -> Result<Self> {
        let mut startofprev_sequence = vec![tokenizer.startofprev()];
        startofprev_sequence.extend_from_slice(&tokenizer.encode("").unwrap());

        let punct_chars: Vec<char> = "?!.,¿¡;".chars().collect();
        let punct_tokens = (0..NUM_TOKENS as i64)
            .filter(|t| {
                punct_chars
                    .iter()
                    .any(|p| tokenizer.decode_single(*t).unwrap().contains(*p))
            })
            .collect();

        Ok(Self {
            encoder,
            decoder,
            tokenizer,

            beam_width: 5,
            reset_after_x_bars: 5,
            overlap_s: 1.0,
            max_parallel_chunks,

            beamsearch_early_prune_min_token_conf: 0.1,
            beamsearch_early_prune_max_decission_postpone: 10,
            max_tokens_without_timing_progress: 20,

            startofprev_sequence,
            punct_chars,
            punct_tokens,
            nudge_towards_punct_delay: 20,
            nudge_towards_punct_rate: 0.01,

            enable_sentence_combiner: true,
        })
    }

    pub fn new_session(
        &mut self,
        audio_reader: AudioReader,
        language: Option<String>,
    ) -> WhisperTranscriptionSession<'_> {
        let audio_len_s = audio_reader.len() as f32 / audio_reader.sample_rate();
        let timing_helper = TimingHelper::new(audio_len_s);

        WhisperTranscriptionSession {
            whisper: self,
            on_new_bar: Box::new(|_| {}),
            on_progress: Box::new(|_| true),
            audio_reader,

            vad_samples: vec![],
            vad_sample_rate: f32::NAN,

            chunks: vec![],
            encoded_chunks: vec![],
            language,
            atoms_left_from_last_bar: vec![],

            timing_helper,
        }
    }
}
impl Debug for WhisperModel {
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

pub struct WhisperTranscriptionSession<'w> {
    whisper: &'w mut WhisperModel,
    on_new_bar: Box<dyn FnMut(WhisperBar)>,
    on_progress: Box<dyn FnMut(f32) -> bool>,
    audio_reader: AudioReader,

    vad_samples: Vec<f32>,
    vad_sample_rate: f32,
    chunks: Vec<Range<f32>>,
    encoded_chunks: Vec<Option<Array2<f32>>>,
    language: Option<String>,
    atoms_left_from_last_bar: Vec<Atom>,

    timing_helper: TimingHelper,
}
impl<'w> WhisperTranscriptionSession<'w> {
    pub fn with_new_bar_listener(mut self, on_new_bar: impl FnMut(WhisperBar) + 'static) -> Self {
        self.on_new_bar = Box::new(on_new_bar);
        self
    }
    pub fn with_progress_listener(
        mut self,
        on_progress: impl FnMut(f32) -> bool + 'static,
    ) -> Self {
        self.on_progress = Box::new(on_progress);
        self
    }

    pub fn transcribe(&mut self) -> Result<()> {
        // step 1: split audio into chunks according to vad data
        let vad = EarshotVadModel::new(&self.audio_reader)?;
        self.vad_samples = vad.get(0..vad.len())?;
        self.vad_sample_rate = vad.sample_rate();

        self.chunks = get_chunks(
            &self.vad_samples,
            self.vad_sample_rate,
            30.0,
            self.whisper.overlap_s,
        );
        self.encoded_chunks.resize(self.chunks.len(), None);
        self.timing_helper.num_chunks = self.chunks.len();

        // step 2: detect language (if unknown)
        if self.language.is_none() {
            event!(Level::INFO, "language is not given, detecting language...");
            // we take a non-silence segment from the middle of the text to detect the language
            let encoded = self.get_encoded_chunk(self.chunks.len() / 2)?;
            let registered = self
                .whisper
                .decoder
                .register_encoded_audio_chunks(&[encoded])?;
            let probs = self.detect_language(&registered)?.remove(0);
            self.language = Some(probs[0].0.to_string());
        };
        event!(
            Level::INFO,
            "language is {}",
            self.language.as_ref().unwrap()
        );
        if !(self.on_progress)(self.timing_helper.get_progress()) {
            event!(Level::INFO, "transcription job aborted");
            bail!("transcription job aborted");
        }

        self.longform_transcribe()?;
        self.outbox_sentence_whisper_bars(&[], true)?;

        self.timing_helper.report_stats();
        Ok(())
    }

    fn longform_transcribe(&mut self) -> Result<()> {
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
        let mut decoded_chunks: Vec<Vec<SequenceData>> = vec![vec![]; self.chunks.len()];
        let mut decoded_chunks_again: Vec<Option<Vec<SequenceData>>> =
            vec![None; self.chunks.len()];
        let mut chunk_states: Vec<ChunkStates> = (0..self.chunks.len())
            .map(|i| {
                if i % self.whisper.reset_after_x_bars == 0 {
                    ChunkStates::CanProcessWithoutContext
                } else {
                    ChunkStates::WaitingForPrevious
                }
            })
            .collect(); // chunks that have a true here are ready to be processed
        self.timing_helper.num_decodes = chunk_states
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
                // slowly ramp up paralellism to get the first bars with less latency and later full throughput
                .take(
                    self.whisper
                        .max_parallel_chunks
                        .min(i.saturating_sub(1).max(1)),
                )
                .map(|(i, _)| i)
                .collect();
            if to_process.is_empty() {
                break;
            }
            let mut audio_encoded = vec![];
            for &i in &to_process {
                let encoded = self.get_encoded_chunk(i)?;
                audio_encoded.push(encoded);
                if !(self.on_progress)(self.timing_helper.get_progress()) {
                    event!(Level::INFO, "transcription job aborted");
                    bail!("aborted");
                }
            }
            let audio_handles = self
                .whisper
                .decoder
                .register_encoded_audio_chunks(&audio_encoded)?;
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
                        let last_chunk = &self.chunks[chunk_idx - 1];
                        last_chunk.end - last_chunk.start - self.whisper.overlap_s
                    } else {
                        0.0
                    };
                    (chunk_idx, audio_handle, previous, last_chunk_duration)
                })
                .collect();

            let outputs = self.transcribe_chunks_with_context(&inputs)?;

            self.timing_helper.chunks_decoded += outputs.len();
            if !(self.on_progress)(self.timing_helper.get_progress()) {
                event!(Level::INFO, "transcription job aborted");
                bail!("aborted");
            }

            for (&chunk_idx, decoded_chunk) in to_process.iter().zip(outputs) {
                if decoded_chunks[chunk_idx].is_empty() {
                    decoded_chunks[chunk_idx] = decoded_chunk;
                } else {
                    decoded_chunks_again[chunk_idx] = Some(decoded_chunk)
                }
                match chunk_states[chunk_idx] {
                    ChunkStates::CanProcessWithoutContext => {
                        if chunk_idx != self.chunks.len() - 1
                            && matches!(
                                chunk_states[chunk_idx + 1],
                                ChunkStates::WaitingForPrevious
                            )
                        {
                            chunk_states[chunk_idx + 1] = ChunkStates::CanProcess;
                        }
                        if chunk_idx == 0 {
                            if chunk_idx == self.chunks.len() - 1 {
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

                        if chunk_idx == self.chunks.len() - 1 {
                            chunk_states[chunk_idx] = ChunkStates::Done;
                        } else if let ChunkStates::Done | ChunkStates::NeedsNextToDecide =
                            chunk_states[chunk_idx + 1]
                        {
                            chunk_states[chunk_idx] = ChunkStates::Done;
                        } else {
                            chunk_states[chunk_idx] = ChunkStates::NeedsNextToDecide;
                        }

                        if chunk_idx != self.chunks.len() - 1
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
                let bar = self.select_transcribed_chunk(
                    outboxed_idx,
                    decoded_chunks_again[outboxed_idx]
                        .as_ref()
                        .unwrap_or(&decoded_chunks[outboxed_idx]),
                    decoded_chunks_again[outboxed_idx]
                        .as_ref()
                        .map(|_| &decoded_chunks[outboxed_idx]),
                    if outboxed_idx < self.chunks.len() - 1 {
                        decoded_chunks_again[outboxed_idx + 1]
                            .as_ref()
                            .or(decoded_chunks.get(outboxed_idx + 1))
                    } else {
                        None
                    },
                )?;
                let to_atoms = self.sequence_data_to_atoms(outboxed_idx, &bar)?;
                self.outbox_sentence_whisper_bars(&to_atoms, false)?;
                self.encoded_chunks[outboxed_idx] = None;
                decoded_chunks[outboxed_idx] = vec![];
                decoded_chunks_again[outboxed_idx] = None;
                outboxed_idx += 1;
            }
        }
        Ok(())
    }

    #[instrument(level = Level::TRACE, skip_all)]
    fn get_encoded_chunk(&mut self, chunk_idx: usize) -> Result<Array2<f32>> {
        if self.encoded_chunks[chunk_idx].is_none() {
            let chunk = &self.chunks[chunk_idx];
            let samples = self.audio_reader.get(
                (chunk.start * self.audio_reader.sample_rate()) as usize
                    ..(chunk.end * self.audio_reader.sample_rate()) as usize,
            )?;
            let start = Instant::now();
            let mel = compute_mel(samples.to_vec())?;
            let mut encoded = self.whisper.encoder.encode(mel)?;
            self.timing_helper.encode.push(start.elapsed());

            // mask away the parts that are not enceded (tryout of just running the encoder on smaller chunks)
            // this sometimes breaks the encoder generating eot tokens (baad)
            let mask_start = ((chunk.end - chunk.start) / 30. * 1500.) as usize;
            *encoded.slice_mut(s![mask_start..1500, ..]) *= 0.0;

            self.encoded_chunks[chunk_idx] = Some(encoded);
        }
        Ok(self.encoded_chunks[chunk_idx].as_ref().unwrap().clone())
    }

    #[instrument(level = Level::TRACE, skip_all)]
    fn select_transcribed_chunk(
        &mut self,
        chunk_idx: usize,
        chunk: &Vec<SequenceData>,
        chunk_without_context: Option<&Vec<SequenceData>>,
        next_chunk: Option<&Vec<SequenceData>>,
    ) -> Result<SequenceData> {
        let sequence_data = if let Some(next_chunk) = next_chunk {
            let next_prompts: Vec<_> = next_chunk
                .iter()
                .map(|seq| {
                    let prompt = &seq.tokens[..seq.tokens.len() - seq.new_tokens];
                    let prompt = if prompt.starts_with(&self.whisper.startofprev_sequence) {
                        &prompt[self.whisper.startofprev_sequence.len()..]
                    } else {
                        prompt
                    };
                    let prompt_without_special: Vec<i64> = prompt
                        .iter()
                        .cloned()
                        .filter(|t| {
                            !self
                                .whisper
                                .tokenizer
                                .decode_single(*t)
                                .unwrap()
                                .contains("<|")
                        })
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
                self.whisper.tokenizer.decode(next_prompt)?
            );

            event!(Level::DEBUG, chunk_idx, "options:");
            for seq in chunk {
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "\t{}",
                    self.whisper.tokenizer.decode(&seq.tokens)?
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
                        self.whisper.tokenizer.decode(&seq.tokens)?
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
                struct PossibleJoinPoint {
                    offset_in_with_context: usize,
                    prompt_offset: usize,
                    overlap_len: usize,
                }
                let mut possible_join_points: Vec<PossibleJoinPoint> = vec![];
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

                            possible_join_points.push(PossibleJoinPoint {
                                offset_in_with_context,
                                prompt_offset,
                                overlap_len: try_prompt.len(),
                            });
                        }
                    }
                }
                possible_join_points.sort_by_key(|x| x.overlap_len);
                let join_point = if let Some(p) = possible_join_points.last() {
                    p
                } else {
                    event!(
                        Level::ERROR,
                        chunk_idx,
                        "could not fit bars together. this _will_ cause an artifact (taking bar with context)",
                    );
                    &PossibleJoinPoint {
                        offset_in_with_context: with_context.tokens.len(),
                        prompt_offset: next_prompt.len(),
                        overlap_len: 0,
                    }
                };

                if join_point.overlap_len < 5 {
                    event!(
                        Level::WARN,
                        chunk_idx,
                        "overlap in gluing bars together is very small {} tokens. the result might be wrong",
                        join_point.overlap_len
                    );
                }
                event!(
                    Level::INFO,
                    chunk_idx,
                    "offset_in_with_context={}, prompt_offset={}, overlap_len={}",
                    join_point.offset_in_with_context,
                    join_point.prompt_offset,
                    join_point.overlap_len
                );

                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "from with    context: {}",
                    self.whisper
                        .tokenizer
                        .decode(&with_context.tokens[..join_point.offset_in_with_context])
                        .unwrap()
                );
                let without_context_start = match_without_context.tokens.len()
                    + join_point.prompt_offset
                    - next_prompt.len();
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "from without context: {}",
                    self.whisper
                        .tokenizer
                        .decode(&match_without_context.tokens[without_context_start..])
                        .unwrap()
                );

                let len_before = with_context.len() as i64;
                with_context.tokens =
                    with_context.tokens[..join_point.offset_in_with_context].to_vec();
                with_context.logprobs =
                    with_context.logprobs[..join_point.offset_in_with_context].to_vec();
                with_context.alignment_data =
                    with_context.alignment_data.with_elements_removed_from_end(
                        with_context.alignment_data.len() - join_point.offset_in_with_context,
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

        Ok(sequence_data)
    }

    #[instrument(level = Level::TRACE, skip_all)]
    pub fn sequence_data_to_atoms(
        &mut self,
        chunk_idx: usize,
        sequence_data: &SequenceData,
    ) -> Result<Vec<Atom>> {
        let chunk_range = &self.chunks[chunk_idx];
        let new_tokens_start = sequence_data.len() - sequence_data.new_tokens;
        let preprocessed = preprocess_alignment_data(
            sequence_data.alignment_data_concatenated(new_tokens_start - 2),
            ((chunk_range.end - chunk_range.start) * 1500. / 30.) as usize,
        );
        let alignment = calculate_alignment(preprocessed.clone())?;

        self.timing_helper.output_tokens += sequence_data.tokens[new_tokens_start..].len();

        let mut atoms = vec![];
        for (i, token) in sequence_data.tokens[new_tokens_start..].iter().enumerate() {
            let text = self.whisper.tokenizer.decode_single(*token).unwrap();
            let start = alignment[i + 1] as f32 / 1500. * 30. + chunk_range.start;
            let end = alignment[i + 2] as f32 / 1500. * 30. + chunk_range.start;
            let conf = sequence_data.logprobs[new_tokens_start + i].exp();
            let to_split = if let Some(word) = text.strip_prefix(char::is_whitespace) {
                // we split the whitespace off the token
                let vad_samples = &self.vad_samples[(start * self.vad_sample_rate) as usize
                    ..(end * self.vad_sample_rate) as usize];
                let mut seen_speech = false;
                vad_samples
                    .iter()
                    .enumerate()
                    .rev()
                    .find(|(_, s)| {
                        if seen_speech && **s < 0.5 {
                            return true;
                        }
                        if **s > 0.5 {
                            seen_speech = true;
                        }
                        false
                    })
                    .map(|(i, _)| (i as f32 / self.vad_sample_rate, text.len() - word.len()))
            } else {
                None
            };
            if let Some((split_time, split_str_offset)) = to_split {
                atoms.push(Atom::WithTiming {
                    conf,
                    conf_ts: 1.0,
                    text: text[..split_str_offset].to_string(),
                    start,
                    end: start + split_time,
                });
                atoms.push(Atom::WithTiming {
                    conf,
                    conf_ts: 1.0,
                    text: text[split_str_offset..].to_string(),
                    start: start + split_time,
                    end,
                });
            } else {
                atoms.push(Atom::WithTiming {
                    conf,
                    conf_ts: 1.0,
                    text,
                    start,
                    end,
                });
            }
        }

        Ok(atoms)
    }

    pub fn outbox_sentence_whisper_bars(&mut self, new_atoms: &[Atom], flush: bool) -> Result<()> {
        if !self.whisper.enable_sentence_combiner {
            (self.on_new_bar)(WhisperBar {
                language: self.language.as_ref().unwrap().clone(),
                atoms: new_atoms.to_vec(),
            });
            return Ok(());
        }
        self.atoms_left_from_last_bar.extend_from_slice(new_atoms);

        // we dont split after the last token in our current working set because the context after it can make
        // a difference when determening breaks.
        let text = self
            .atoms_left_from_last_bar
            .iter()
            .map(|a| a.text())
            .collect::<String>();
        let split = segment(self.language.as_ref().unwrap(), &text);
        for sentence in &split[..split.len() - 1] {
            let mut len_so_far = 0;
            let num_atoms = self
                .atoms_left_from_last_bar
                .iter()
                .take_while(|a| {
                    len_so_far += a.text().len();
                    len_so_far <= sentence.len()
                })
                .count();
            let rest = self.atoms_left_from_last_bar.split_off(num_atoms);
            let current_bar = std::mem::replace(&mut self.atoms_left_from_last_bar, rest);

            // merge tokens to words in current bar
            let mut words_merged: Vec<Atom> = vec![];
            for atom in current_bar {
                if !words_merged
                    .last()
                    .map(|a| {
                        a.text().ends_with(|c: char| {
                            self.whisper.punct_chars.contains(&c) || c.is_whitespace()
                        })
                    })
                    .unwrap_or(true)
                    && !atom.text().starts_with(char::is_whitespace)
                {
                    words_merged.last_mut().unwrap().append_atom(&atom);
                } else {
                    words_merged.push(atom);
                }
            }

            (self.on_new_bar)(WhisperBar {
                language: self.language.as_ref().unwrap().clone(),
                atoms: words_merged,
            });
        }

        if flush {
            (self.on_new_bar)(WhisperBar {
                language: self.language.as_ref().unwrap().clone(),
                atoms: std::mem::take(&mut self.atoms_left_from_last_bar),
            })
        }
        Ok(())
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
    fn transcribe_chunks_with_context(
        &mut self,
        x: &[(usize, AudioChunkHandle, &Vec<SequenceData>, f32)],
    ) -> Result<Vec<Vec<SequenceData>>> {
        let mut transcribe_chunk_inputs: Vec<(usize, AudioChunkHandle, Vec<SequenceData>)> = vec![];
        for (chunk_idx, audio_chunk_handle, initial_beams, last_chunk_duration) in x {
            let mut prompts = vec![];
            for seq in initial_beams.iter() {
                let mut tokens = vec![];
                let mut logprobs = vec![];
                let context_tokens_start =
                    seq.new_tokens.saturating_sub(WhisperModel::MAX_CONTEXT_LEN)
                        + (seq.len() - seq.new_tokens);
                let context_tokens = &seq.tokens[context_tokens_start..];

                // fill context from the provided last sequences
                if !context_tokens.is_empty() {
                    tokens.extend_from_slice(&self.whisper.startofprev_sequence);
                    logprobs.extend_from_slice(&vec![0.0; self.whisper.startofprev_sequence.len()]);

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
                        && self.whisper.punct_chars.iter().any(|c| {
                            self.whisper
                                .tokenizer
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

                    let sot_sequence = &self
                        .whisper
                        .tokenizer
                        .sot_sequence(self.language.as_ref().unwrap())
                        .unwrap();
                    tokens.extend_from_slice(sot_sequence);
                    logprobs.extend_from_slice(&vec![0.0; sot_sequence.len()]);

                    tokens
                        .extend_from_slice(&seq.tokens[context_tokens_start + leftmost_on_right..]);
                    logprobs.extend_from_slice(
                        &seq.logprobs[context_tokens_start + leftmost_on_right..],
                    );
                } else {
                    let sot_sequence = &self
                        .whisper
                        .tokenizer
                        .sot_sequence(self.language.as_ref().unwrap())
                        .unwrap();
                    tokens.extend_from_slice(sot_sequence);
                    logprobs.extend_from_slice(&vec![0.0; sot_sequence.len()]);
                }

                let prompt_sequence = SequenceData {
                    tokens: tokens.clone(),
                    logprobs: logprobs.to_vec(),
                    naive_token_times: vec![],
                    eot_prob: vec![],
                    alignment_data: Default::default(),
                    new_tokens: 0,
                    tokens_since_last_punct: seq.tokens_since_last_punct,
                };

                prompts.push(prompt_sequence);
            }

            event!(Level::DEBUG, chunk_idx, "prompts:");
            for prompt in &prompts {
                event!(
                    Level::DEBUG,
                    chunk_idx,
                    "\t{}",
                    self.whisper.tokenizer.decode(&prompt.tokens).unwrap()
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
                    self.whisper
                        .tokenizer
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
                        self.whisper
                            .tokenizer
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
                        .whisper
                        .tokenizer
                        .decode_single(seq.tokens[seq.tokens.len() - 2])
                        .unwrap();
                    if self
                        .whisper
                        .punct_chars
                        .iter()
                        .any(|c| last_token_str.contains(*c))
                    {
                        add_sequence(2, 0.9);
                    }
                }

                // peel of one word of the most likely sequence
                // (because the last word is sometimes bullshit when it is cut of in the middle)
                if i == 0 {
                    let mut peel = 2;
                    while seq.new_tokens > peel {
                        if self
                            .whisper
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
                        self.whisper.tokenizer.decode(&seq.tokens).unwrap(),
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
    fn transcribe_chunks(
        &mut self,
        x: &[(usize, AudioChunkHandle, Vec<SequenceData>)],
    ) -> Result<Vec<Vec<SequenceData>>> {
        let mut chunks: Vec<(AudioChunkHandle, Vec<(SequenceHandle, SequenceData)>)> = Vec::new();
        for (_chunk_idx, audio, prompts) in x {
            chunks.push((
                audio.clone(),
                prompts
                    .iter()
                    .map(|sequence_data| {
                        (
                            self.whisper
                                .decoder
                                .register_sequence(&sequence_data.tokens),
                            sequence_data.clone(),
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
                .filter(|&(chunk_idx, _)| finished[chunk_idx].len() < self.whisper.beam_width)
                .flat_map(|(chunk_idx, (audio, beam))| {
                    if !beam.is_empty() {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "beam width: {}; finished: {}",
                            beam.len(),
                            finished[chunk_idx].len()
                        );
                        self.timing_helper.beam_widths.push(beam.len());
                    }

                    beam.iter().map(|(seq, _)| (audio.clone(), seq.clone()))
                })
                .collect();
            if decoder_input.is_empty() {
                break;
            }

            let start = Instant::now();
            let (logits, alignment_data) = self.whisper.decoder.forward(&decoder_input)?;
            if alignment_data.shape()[2] > 1 {
                self.timing_helper
                    .prefill
                    .push((start.elapsed(), alignment_data.shape()[0]));
            } else {
                self.timing_helper
                    .decode
                    .push((start.elapsed(), alignment_data.shape()[0]));
            }

            let nospeech = &[self.whisper.tokenizer.nospeech()];
            let nospeech_and_endoftext = &[
                self.whisper.tokenizer.endoftext(),
                self.whisper.tokenizer.nospeech(),
            ];
            let mask = if false {
                // as the first token, we extrude a timestamp token with a certain maximum time
                let mut mask = Array1::zeros(NUM_TOKENS);
                for i in 0..NUM_TOKENS {
                    mask[i] = f32::NEG_INFINITY;
                }
                for time in self.whisper.tokenizer.encode_single("<|0.00|>").unwrap()
                    ..self.whisper.tokenizer.encode_single("<|1.00|>").unwrap()
                {
                    mask[time as usize] = 0.0;
                }
                mask
            } else {
                self.whisper.tokenizer.special_tokens_mask(if i == 0 {
                    nospeech
                } else {
                    nospeech_and_endoftext
                }) + self.whisper.tokenizer.non_speech_tokens_mask()
            };

            let result = logits + mask;

            let mut next_chunks = chunks.clone();
            let mut result_idx = 0;
            for (chunk_idx, (_audio, beam)) in chunks.iter().enumerate() {
                if finished[chunk_idx].len() >= self.whisper.beam_width {
                    continue;
                }
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(usize, &SequenceHandle, i64, f32)> =
                    TopNVec::new(self.whisper.beam_width);
                let mut new_sequence_datas = vec![];

                for (beam_idx, (seq_handle, sequence_data)) in beam.iter().enumerate() {
                    let last_token_idx = if i == 0 { sequence_data.len() - 1 } else { 0 };
                    let mut result_slice =
                        result.slice(s![result_idx, last_token_idx, ..]).to_owned();
                    if sequence_data.tokens_since_last_punct
                        > self.whisper.nudge_towards_punct_delay
                    {
                        let nudge_factor = (sequence_data.tokens_since_last_punct
                            - self.whisper.nudge_towards_punct_delay)
                            as f32
                            * self.whisper.nudge_towards_punct_rate;
                        for t in &self.whisper.punct_tokens {
                            result_slice[*t as usize] *= 1.0 + nudge_factor;
                        }
                    }

                    let token_probs: Array1<f32> =
                        softmax(result_slice.into_dyn(), Axis(0)).into_dimensionality()?;

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
                        .push(token_probs[self.whisper.tokenizer.endoftext() as usize]);
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
                    let next_seq = self.whisper.decoder.append_token_to_sequence(seq, token)?;
                    let naive_token_time = *next_sequence_data.naive_token_times.last().unwrap();
                    let token_str = self.whisper.tokenizer.decode_single(token).unwrap();
                    if self
                        .whisper
                        .punct_chars
                        .iter()
                        .any(|p| token_str.contains(*p))
                    {
                        next_sequence_data.tokens_since_last_punct = 0;
                    } else {
                        next_sequence_data.tokens_since_last_punct += 1;
                    }

                    if token == self.whisper.tokenizer.endoftext() {
                        if token_prob > self.whisper.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> finished",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            finished[chunk_idx].push(next_sequence_data);
                        } else {
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                        }
                    } else if next_sequence_data.len() >= WhisperModel::MAX_DECODER_TOKENS
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
                            self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                        );
                        finished[chunk_idx].push(next_sequence_data);
                    } else if finished[chunk_idx].is_empty() {
                        // we cannot prune all

                        if next_sequence_data.naive_token_times.len()
                            > self.whisper.max_tokens_without_timing_progress
                            && next_sequence_data.eot_prob.len()
                                > self.whisper.max_tokens_without_timing_progress
                            && next_sequence_data.naive_token_times
                                [next_sequence_data.naive_token_times.len() - 1]
                                == next_sequence_data.naive_token_times[next_sequence_data
                                    .naive_token_times
                                    .len()
                                    - self.whisper.max_tokens_without_timing_progress
                                    - 1]
                        {
                            // no timing progress since 20 tokens: probably we are stuck in a loop but we did not generate
                            // an eot token yet. Now we cut the sequence at the position that is most likely to be the end
                            let eot_probs: &[f32] =
                                &next_sequence_data.eot_prob[next_sequence_data.eot_prob.len()
                                    - self.whisper.max_tokens_without_timing_progress..];
                            let mut argmax = 0;
                            let mut max = 0.0;
                            for (i, &x) in eot_probs.iter().enumerate() {
                                if x > max {
                                    max = x;
                                    argmax = i
                                }
                            }
                            let cut_sequence = next_sequence_data.with_x_tokens_removed_from_end(
                                self.whisper.max_tokens_without_timing_progress - argmax,
                            );
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> finished (cut tokens of end because no progress)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                                score
                            );
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "cut tokens of end eot probs: {:?}",
                                eot_probs
                            );
                            finished[chunk_idx].push(cut_sequence);
                            break;
                        }

                        if best_token_prob < self.whisper.beamsearch_early_prune_min_token_conf {
                            // all options are shit, we cannot decide now, thus we keep all beams
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> continue (because all are shit)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            next_beam.push((next_seq, next_sequence_data));
                        } else if token_prob > self.whisper.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            next_beam.push((next_seq, next_sequence_data));
                        } else {
                            // we prune the beam
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            self.timing_helper.pruned += 1;
                        }
                    } else {
                        // we could prune all

                        if next_sequence_data.naive_token_times.len()
                            > self.whisper.max_tokens_without_timing_progress
                            && next_sequence_data.naive_token_times
                                [next_sequence_data.naive_token_times.len() - 1]
                                == next_sequence_data.naive_token_times[next_sequence_data
                                    .naive_token_times
                                    .len()
                                    - self.whisper.max_tokens_without_timing_progress
                                    - 1]
                        {
                            // we prune the beam because of no timing progress
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (no timing progress since {} tokens)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                                score,
                                self.whisper.max_tokens_without_timing_progress
                            );
                            self.timing_helper.pruned += 1;
                        }
                        if token_prob > self.whisper.beamsearch_early_prune_min_token_conf
                            || next_sequence_data.logprob_sum_normalized() > best_score
                        {
                            next_beam.push((next_seq, next_sequence_data));
                        } else {
                            // we prune the beam
                            event!(
                                Level::TRACE,
                                chunk_idx = x[chunk_idx].0,
                                "{} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (too low token prob)",
                                self.whisper.tokenizer.decode(&next_sequence_data.tokens)?,
                            );
                            self.timing_helper.pruned += 1;
                        }
                    }
                }
                let next_beam_clone = next_beam.clone();
                next_beam.retain(|(_, sequence_data)| {
                    if sequence_data.tokens.len()
                        < self.whisper.beamsearch_early_prune_max_decission_postpone
                    {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "{tokens} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> continue",
                            tokens = self.whisper.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        self.timing_helper.not_pruned += 1;
                        return true;
                    };
                    let sibling_tokens = &sequence_data.tokens[sequence_data.tokens.len()
                        - self.whisper.beamsearch_early_prune_max_decission_postpone
                        ..sequence_data.tokens.len()];
                    let siblings = next_beam_clone
                        .iter()
                        .map(|(_, sequence_data)| sequence_data)
                        .filter(|candidate| {
                            if candidate.tokens.len()
                                < self.whisper.beamsearch_early_prune_max_decission_postpone
                            {
                                return false;
                            };
                            let candidate_sibling_tokens = &candidate.tokens[candidate.tokens.len()
                                - self.whisper.beamsearch_early_prune_max_decission_postpone
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
                            tokens = self.whisper.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        self.timing_helper.not_pruned += 1;
                        true
                    } else {
                        event!(
                            Level::TRACE,
                            chunk_idx = x[chunk_idx].0,
                            "{tokens} (score: {score}; token_prob: {token_prob}; naive_token_time: {naive_token_time}) -> prune (max decision time exceeded)",
                            tokens = self.whisper.tokenizer.decode(&sequence_data.tokens).unwrap(),
                            score = sequence_data.logprob_sum_normalized(),
                            token_prob = sequence_data.logprobs.last().unwrap().exp(),
                            naive_token_time = sequence_data.naive_token_times.last().unwrap()
                        );
                        self.timing_helper.pruned += 1;
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
    fn detect_language(
        &mut self,
        chunks: &[AudioChunkHandle],
    ) -> Result<Vec<Vec<(&'static str, f32)>>> {
        let len = chunks.len();
        let prompt = self
            .whisper
            .decoder
            .register_sequence(&[self.whisper.tokenizer.startoftranscript()]);
        let decoder_input: Vec<_> = chunks
            .iter()
            .map(|chunk| (chunk.clone(), prompt.clone()))
            .collect();
        let (logits, _alignment_data) = self.whisper.decoder.forward(&decoder_input)?;

        let language_tokens = LANGUAGES
            .iter()
            .map(|(code, _)| {
                Ok((
                    self.whisper
                        .tokenizer
                        .encode_single(&format!("<|{code}|>"))?,
                    *code,
                ))
            })
            .collect::<Result<HashMap<_, _>>>()?;
        let mask = self
            .whisper
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

#[derive(Clone, Default)]
pub struct SequenceData {
    tokens: Vec<i64>,
    logprobs: Vec<f32>,
    naive_token_times: Vec<f32>, // tend to be too low, used to check if transcription is stuck in a loop
    eot_prob: Vec<f32>,
    alignment_data: TreeList<Array2<f32>>, // [heads, audio_len],
    new_tokens: usize,
    tokens_since_last_punct: usize,
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
            tokens_since_last_punct: self.tokens_since_last_punct - x,
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
            to_return.push_str(a.text());
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

#[derive(Debug, Clone)]
pub enum Atom {
    WithTiming {
        text: String,
        conf: f32,
        start: f32,
        end: f32,
        conf_ts: f32,
    },
    #[allow(dead_code)] // this is not supported by the frontend atm
    WithoutTiming { text: String, conf: f32 },
}
impl Atom {
    fn text(&self) -> &str {
        match self {
            Atom::WithTiming { text, .. } => text,
            Atom::WithoutTiming { text, .. } => text,
        }
    }

    fn append_atom(&mut self, other: &Atom) {
        match (self, other) {
            (
                Atom::WithTiming {
                    text,
                    conf,
                    start: _start,
                    end,
                    conf_ts,
                },
                Atom::WithTiming {
                    text: other_text,
                    conf: other_conf,
                    start: _other_start,
                    end: other_end,
                    conf_ts: other_conf_ts,
                },
            ) => {
                *text += other_text;
                *conf = (*conf + *other_conf) / 2.;
                *end = *other_end;
                *conf_ts = (*conf_ts + *other_conf_ts) / 2.;
            }
            _ => unimplemented!(),
        }
    }

    fn as_json(&self) -> String {
        match self {
            Atom::WithTiming {
                text,
                conf,
                start,
                end,
                conf_ts,
            } => format!(
                "{{ \"text\": \"{text}\", \"conf\": {conf}, \"start\": {start}, \"end\": {end}, \"conf_ts\": {conf_ts} }}",
            ),
            Atom::WithoutTiming { text, conf } => {
                format!("{{ \"text\": \"{text}\", \"conf\": {conf} }}",)
            }
        }
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

    #[test]
    fn test_sentence_segmenter() {
        use icu_locale::langid;
        use icu_segmenter::SentenceSegmenter;
        use icu_segmenter::options::SentenceBreakOptions;

        let mut options = SentenceBreakOptions::default();
        let langid = &langid!("de");
        options.content_locale = Some(langid);
        let segmenter = SentenceSegmenter::try_new(options).unwrap();

        let text =
            "Es gibt viele schwierige Verkehrsteilnehmer, z.B. Autos. Diese sind doof... lol";
        let breakpoints: Vec<usize> = segmenter.as_borrowed().segment_str(text).collect();
        let snippets: Vec<&str> = breakpoints.windows(2).map(|w| &text[w[0]..w[1]]).collect();
        dbg!(snippets);
        assert_eq!(&breakpoints, &[0, 13, 36]);
    }
}
