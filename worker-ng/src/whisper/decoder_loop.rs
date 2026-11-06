//! This file contains the "outer" logic of whisper decoding.
//! I.e. everything that is not backend (the number crunching part) specific.
//! It does stuff like coordinate beamsearch, initiate the word level timestamp reconstruction
//! and feeding audio chunks to the backend. The interface between it and the backend is the
//! WhisperDecoderBackend trait.

use super::decoder::{AudioChunkHandle, SequenceHandle};
use super::decoder::{DynWhisperDecoderBackend, TokenSequence};
use super::encoder::{DynWhisperEncoderBackend, compute_mel};
use super::math::softmax;
use super::timing::calculate_alignment;
use super::tokenizer::Tokenizer;
use crate::audio_reader::{AudioReader, format_time};
use crate::vad::earshot::EarshotVadModel;
use crate::vad::transcription_restart::get_restart_points;
use crate::whisper::reference::{read_ndarray_from_file, write_ndarray_to_file};
use crate::whisper::tokenizer::LANGUAGES;
use anyhow::Result;
use log::{debug, info};
use ndarray::{Array2, Array3, Axis, concatenate, s};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

type ChunkedAlignmentData = Vec<Array3<f32>>; // [heads, tokens (vec dim), audio_in]

pub struct WhisperBar {
    pub atoms: Vec<Atom>,
}

#[derive(Debug)]
pub struct Atom {
    pub conf: f32,
    pub conf_ts: f32,
    pub start: f32,
    pub end: f32,
    pub text: String,
}

pub struct Whisper {
    encoder: DynWhisperEncoderBackend,
    decoder: DynWhisperDecoderBackend,
    tokenizer: Tokenizer,
}
impl Whisper {
    // idea: make the beam_width only wider if we are unsure about the next token. otherwise greedy is fine
    const BEAM_WIDTH: usize = 5;
    const MAX_LEN: usize = 448;

    pub async fn new(
        encoder: DynWhisperEncoderBackend,
        decoder: DynWhisperDecoderBackend,
    ) -> Result<Self> {
        let start = Instant::now();
        let tokenizer = Tokenizer::new().await?;
        info!("Model loading took {:?}", start.elapsed());

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
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
        info!("running VAD...");
        let vad = EarshotVadModel::new(ar).await?;
        let block_len = 5. * 60.; // 5 minutes
        let restart_points = get_restart_points(
            &vad.get(0..vad.len())?,
            (vad.sample_rate() * block_len) as usize,
        );

        info!("restart points:");
        for p in &restart_points {
            let time = *p as f32 / vad.sample_rate();
            info!("\t {}", format_time(time));
        }

        // step 2: detect language (if unknown)
        let language = if language.is_none() {
            info!("language is not given, detecting language...");
            // we take a non-silence segment from the middle of the text to detect the language
            let beginning = if restart_points.is_empty() {
                0
            } else {
                restart_points[restart_points.len() / 2]
            };
            let wanted_end = beginning + 16_000 * 30;
            let real_end = wanted_end.min(ar.len());
            let samples = ar.get(beginning..real_end)?;
            let chunk = compute_mel(samples.to_vec())?;
            let chunk = self.encoder.encode(chunk)?;
            let registered = self.decoder.register_encoded_audio_chunks(&[chunk])?;
            let probs = self.detect_language(&registered)?.remove(0);
            probs[0].0
        } else {
            language.unwrap()
        };
        info!("language is {language}");

        let mut chunk_start = 0.0;
        let audio_frames = ar.len();

        let mut last_tokens: Option<Vec<(i64, f32)>> = None;
        loop {
            let start_frames = (chunk_start * 16_000.) as usize;
            let desired_end_frames = start_frames + (16_000 * 30);
            let actual_end_frames = desired_end_frames.min(audio_frames);
            let chunk_len = actual_end_frames - start_frames;
            let chunk_len_s = chunk_len as f32 / 16_000.;

            let samples = ar.get(start_frames..actual_end_frames)?;
            let mel = compute_mel(samples.to_vec())?;
            let encoded = self.encoder.encode(mel)?;
            let handles = self.decoder.register_encoded_audio_chunks(&[encoded])?;

            let mut sot_sequence = vec![];
            if let Some(last_tokens) = last_tokens {
                sot_sequence.push(self.tokenizer.startofprev());
                for i in 0..20 {
                    sot_sequence.push(last_tokens[i + last_tokens.len() - 2 - 20].0);
                }
            }
            sot_sequence.extend_from_slice(&self.tokenizer.sot_sequence(language)?);

            let chunk = self.transcribe_chunks(&[(handles[0].clone(), vec![sot_sequence])])?;
            let beams = chunk.first().unwrap();
            let (seq, alignment_data) = beams.first().unwrap();
            let alignment_data = concatenate(
                Axis(1),
                &alignment_data.iter().map(|x| x.view()).collect::<Vec<_>>(),
            )
            .unwrap()
            .into_owned();

            last_tokens = Some(seq.clone());
            let alignment =
                calculate_alignment(alignment_data.clone(), (chunk_len_s / 30. * 1500.) as usize)?;
            let atoms = seq
                .iter()
                .zip(alignment.iter().zip(alignment.iter().skip(1)))
                .map(|(&(token, conf), (start, end))| Atom {
                    conf,
                    conf_ts: 1.0,
                    start: *start as f32 / 1500.,
                    end: *end as f32 / 1500.,
                    text: self.tokenizer.decode(&[token]).unwrap(),
                })
                .collect();
            on_new_bar(WhisperBar { atoms });
            chunk_start += alignment[alignment.len() - 2] as f32 / 1500. * 30.;
            if chunk_len < 16_000 * 30 {
                break;
            }
        }

        let audio_len_s = audio_frames as f32 / 16_000.0;
        let duration = start_time.elapsed().as_secs_f32();
        info!(
            "transcription of the first {audio_len_s:.2}s took {duration:.2}s ({:.2}x realtime)",
            audio_len_s / duration
        );
        Ok(())
    }

    /// This function detects the lanuage of the given audio chunks and returns a probability
    /// distribution of (lang, probability) for each chunk
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

    /// This function transcribes one chunk of audio with beam search and decides on one concrete
    /// beam. It does not yet do timing reconstruction but only returns the data for that.
    ///
    /// `x` contains AudioChunks and Prompts. Multiple prompts represent multiple beams in beam search.
    pub fn transcribe_chunks(
        &mut self,
        x: &[(AudioChunkHandle, Vec<Vec<i64>>)],
    ) -> Result<Vec<Vec<(TokenSequence, ChunkedAlignmentData)>>> {
        let start = Instant::now();
        let mut beams = Vec::new();
        for (chunk, prompts) in x {
            beams.push((
                chunk.clone(),
                prompts
                    .iter()
                    .map(|prompt| (self.decoder.register_sequence(prompt), vec![]))
                    .collect::<Vec<_>>(),
            ));
        }

        let mut finished: Vec<Vec<(TokenSequence, ChunkedAlignmentData)>> = vec![vec![]; x.len()];
        for i in 0.. {
            let loop_start = Instant::now();
            let decoder_input: Vec<_> = beams
                .iter()
                .enumerate()
                .filter(|&(beam_idx, _)| finished[beam_idx].len() < Self::BEAM_WIDTH)
                .flat_map(|(_, (chunk, beam))| {
                    beam.iter().map(|(seq, _)| (chunk.clone(), seq.clone()))
                })
                .collect();
            if decoder_input.is_empty() {
                break;
            }

            let (logits, alignment_data) = self.decoder.forward(&decoder_input)?;
            let endoftext = &[self.tokenizer.endoftext(), self.tokenizer.nospeech()];
            let nospeech = &[self.tokenizer.nospeech()];
            let result = logits
                + self
                    .tokenizer
                    .special_tokens_mask(if i == 0 { nospeech } else { endoftext })
                + self.tokenizer.non_speech_tokens_mask();
            let last_axis = Axis(result.shape().len() - 1);
            let token_probs: Array3<f32> = softmax(result.into_dyn(), last_axis)
                .into_dimensionality()
                .unwrap();

            let mut next_beams = Vec::new();
            let mut result_idx = 0;
            for (beam_idx, (chunk, beam)) in beams.iter().enumerate() {
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(usize, &SequenceHandle, usize, f32)> =
                    TopNVec::new(Self::BEAM_WIDTH);
                let mut new_alignment_vecs = vec![];
                for (seq, alignment_vec) in beam.iter() {
                    let seq_tokens = self.decoder.get_tokens(seq)?;
                    let last_token_idx = if i == 0 { seq_tokens.len() - 1 } else { 0 };
                    let token_probs = token_probs.slice(s![result_idx, last_token_idx, ..]);
                    let new_alignment_data = alignment_data
                        .slice(s![
                            result_idx,
                            ..,
                            .., /* TODO: slice according to length */
                            ..
                        ])
                        .to_owned();

                    let mut new_alignment_vec = alignment_vec.clone();
                    new_alignment_vec.push(new_alignment_data);
                    new_alignment_vecs.push(new_alignment_vec);

                    let seq_base_logprob = Self::logprob_of_seq(&seq_tokens);
                    let seq_len = (&seq_tokens.len() + 1) as f32;
                    for (token, &prob) in token_probs.iter().enumerate() {
                        let total_logprob = (seq_base_logprob + prob.ln()) / seq_len;
                        best.insert(total_logprob, (result_idx, seq, token, prob));
                    }

                    result_idx += 1;
                }

                for (i, &(result_idx, seq, token, conf)) in best.iter().enumerate() {
                    if i != 0 && conf < 0.1 {
                        continue;
                    }
                    let next_seq =
                        self.decoder
                            .append_token_to_sequence(seq, token as i64, conf)?;
                    let tokens = self.decoder.get_tokens(&next_seq)?;

                    let only_tokens: Vec<_> = tokens.iter().map(|(t, _)| *t).collect();
                    debug!(
                        "{} {}",
                        self.tokenizer.decode(&only_tokens)?,
                        Self::logprob_of_seq(&tokens) / tokens.len() as f32
                    );

                    if token as i64 == self.tokenizer.endoftext() || tokens.len() >= Self::MAX_LEN {
                        finished[beam_idx].push((tokens, new_alignment_vecs[result_idx].clone()));

                        /*
                        let alignment_data = concatenate(
                            Axis(1),
                            &new_alignment_vecs[result_idx]
                                .iter()
                                .map(|x| x.view())
                                .collect::<Vec<_>>(),
                        )
                        .unwrap()
                        .into_dyn()
                        .into_owned();

                        write_ndarray_to_file(
                            &Path::new("target/alignment.npy").to_path_buf(),
                            alignment_data,
                        );
                         */
                    } else {
                        next_beam.push((next_seq, new_alignment_vecs[result_idx].clone()));
                    }
                }
                next_beams.push((chunk.clone(), next_beam));
            }
            beams = next_beams;
            debug!("loop iteration: {:?}\n", loop_start.elapsed());
        }

        info!("decoder took {:?}", start.elapsed());
        Ok(finished.into_iter().map(|x| x).collect())
    }

    fn logprob_of_seq(x: &TokenSequence) -> f32 {
        x.iter().map(|(_, c)| c.ln()).sum::<f32>()
    }
}

/// A datastructure that only stores the top N entries
#[derive(Debug)]
pub struct TopNVec<T> {
    pub n: usize,
    pub min: f32,
    pub data: Vec<(f32, T)>,
}
impl<T> TopNVec<T> {
    fn new(n: usize) -> Self {
        Self {
            n,
            min: f32::INFINITY,
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
        }
    }

    fn iter(&self) -> impl ExactSizeIterator<Item = &T> {
        self.data.iter().map(|(_, v)| v)
    }
}

fn atoms_to_text(atoms: &[Atom]) -> String {
    let mut to_return = String::new();
    for a in atoms {
        to_return.push_str(&a.text);
    }
    to_return
}
