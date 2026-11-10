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
use crate::audio_reader::{AudioReader, format_time};
use crate::vad::chunking::get_chunks;
use crate::vad::earshot::EarshotVadModel;
use crate::whisper::reference::write_ndarray_to_file;
use crate::whisper::timing::calculate_alignment;
use crate::whisper::tokenizer::{LANGUAGES, NUM_TOKENS};
use anyhow::Result;
use log::{debug, info};
use ndarray::{Array1, Array2, Array3, Axis, s, stack};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

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

#[derive(Debug, Clone, Default)]
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
        return self.logprob_sum() / self.len() as f32;
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

pub struct Whisper {
    encoder: DynWhisperEncoderBackend,
    decoder: DynWhisperDecoderBackend,
    tokenizer: Tokenizer,
}
impl Whisper {
    // idea: make the beam_width only wider if we are unsure about the next token. otherwise greedy is fine
    const MAX_LEN: usize = 448;
    const MAX_CONTEXT_LEN: usize = 50;

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
        let chunks = get_chunks(&vad.get(0..vad.len())?, vad.sample_rate(), 30.0, 1.0);

        let vad_data = Array1::from_vec(vad.get(0..vad.len())?);
        write_ndarray_to_file(
            &Path::new("target/vad.npy").to_path_buf(),
            vad_data.into_dyn(),
        );

        // step 2: detect language (if unknown)
        let language = if language.is_none() {
            info!("language is not given, detecting language...");
            // we take a non-silence segment from the middle of the text to detect the language
            let chunk = &chunks[chunks.len() / 2];
            let samples = ar.get(
                (chunk.start * ar.sample_rate()) as usize..(chunk.end * ar.sample_rate()) as usize,
            )?;
            let mel = compute_mel(samples.to_vec())?;
            let encoded = self.encoder.encode(mel)?;
            let registered = self.decoder.register_encoded_audio_chunks(&[encoded])?;
            let probs = self.detect_language(&registered)?.remove(0);
            probs[0].0
        } else {
            language.unwrap()
        };
        info!("language is {language}");

        // step 3: transcribe chunks
        let mut last: Vec<SequenceData> = vec![SequenceData::default()];
        for (chunk_idx, chunk) in chunks.iter().enumerate() {
            info!(
                "\n\nchunk {} - {}",
                format_time(chunk.start),
                format_time(chunk.end)
            );
            let samples = ar.get(
                (chunk.start * ar.sample_rate()) as usize
                    ..((chunk.end * ar.sample_rate()) as usize).min(ar.len()),
            )?;
            let mel = compute_mel(samples.to_vec())?;
            let mut encoded = self.encoder.encode(mel)?;

            // mask away the parts that are not enceded (tryout of just running the encoder on smaller chunks)
            let mask_start = ((chunk.end - chunk.start) / 30. * 1500.) as usize;
            // encoded.slice_mut(s![mask_start..1500, ..]).mul_assign(0.0);

            let handles = self.decoder.register_encoded_audio_chunks(&[encoded])?;

            let mut prompts: Vec<(Vec<i64>, Vec<f32>)> = vec![];
            let mut prompts_to_seq_map: Vec<(Vec<i64>, SequenceData)> = vec![];
            for (i, seq) in last.iter().enumerate() {
                let mut tokens = vec![];
                let mut logprobs = vec![];
                let context_tokens_start = seq.tokens.len().saturating_sub(Self::MAX_CONTEXT_LEN);
                let context_tokens = &seq.tokens[context_tokens_start..];
                if !context_tokens.is_empty() {
                    tokens.push(self.tokenizer.startofprev());
                    logprobs.push(0.0);
                    let sentence_delim = &self.tokenizer.encode("?.,").unwrap();
                    tokens.extend_from_slice(sentence_delim);
                    logprobs.extend_from_slice(&vec![0.0; sentence_delim.len()]);

                    let last_chunk_len = chunk.start - &chunks[chunk_idx - 1].start;
                    let last_chunk_last_idx = (last_chunk_len / 30. * 1500.) as usize;

                    let alignment = seq
                        .alignment_data_concatenated(
                            seq.alignment_data.len() - context_tokens.len() - 1,
                        )
                        .mean_axis(Axis(1))
                        .unwrap();
                    let alignment: Array2<f32> = softmax(alignment.into_dyn(), Axis(1))
                        .into_dimensionality()
                        .unwrap();

                    let leftmost_on_right = 'search: {
                        for i in (1..context_tokens.len()).rev() {
                            let energy_in_last_chunk =
                                alignment.slice(s![i, ..last_chunk_last_idx]).sum();
                            if energy_in_last_chunk > 0.5 {
                                break 'search i + 1;
                            }
                        }
                        context_tokens.len()
                    };

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
                prompts_to_seq_map.push((tokens, seq.clone()));
            }

            info!("prompts:");
            for prompt in &prompts {
                info!("\t{}", self.tokenizer.decode(&prompt.0).unwrap())
            }

            let transcribed = self.transcribe_chunks(&[(handles[0].clone(), prompts)], 5)?;
            let mut beams = transcribed.first().unwrap().clone();

            beams.sort_by(|a, b| {
                (b.logprobs[b.logprobs.len() - b.new_tokens..]
                    .iter()
                    .sum::<f32>()
                    / b.new_tokens as f32)
                    .total_cmp(
                        &(a.logprobs[a.logprobs.len() - a.new_tokens..]
                            .iter()
                            .sum::<f32>()
                            / a.new_tokens as f32),
                    )
            });

            for (i, beam) in beams.iter().enumerate() {
                info!(
                    "beam #{}: {} {} ({} new tokens)",
                    i,
                    self.tokenizer
                        .decode(&beam.tokens[beam.tokens.len() - beam.new_tokens..])
                        .unwrap(),
                    beam.logprobs[beam.logprobs.len() - beam.new_tokens..]
                        .iter()
                        .sum::<f32>()
                        / beam.new_tokens as f32,
                    beam.new_tokens,
                );
            }

            // emit the _last_ bar, now that we actually know which bar the beam search favoured
            if chunk_idx > 0 {
                let best = beams.first().unwrap();
                for (prompt, seq) in &prompts_to_seq_map {
                    if best.tokens.starts_with(&prompt) {
                        let last_chunk = &chunks[chunk_idx - 1];
                        let chunk_len_s = last_chunk.end - last_chunk.start;
                        let alignment = calculate_alignment(
                            seq.alignment_data_concatenated(0),
                            (chunk_len_s / 30. * 1500.) as usize,
                        )?;

                        let atoms: Vec<_> = seq
                            .tokens
                            .iter()
                            .zip(&seq.logprobs)
                            .map(|(token, conf)| Atom {
                                conf: *conf,
                                conf_ts: 1.0,
                                start: 0.0,
                                end: 0.0,
                                text: self.tokenizer.decode_single(*token).unwrap(),
                            })
                            .collect();
                        on_new_bar(WhisperBar { atoms });

                        // we need to kill all beams that do not conform to what we just emited
                        beams.retain(|beam| beam.tokens.starts_with(&prompt));
                        break;
                    }
                }
            }

            last = vec![];
            for (i, seq) in beams.iter().enumerate() {
                let (prompt, _) = prompts_to_seq_map
                    .iter()
                    .find(|(prompt, _)| seq.tokens.starts_with(prompt))
                    .unwrap();

                let new_seq = SequenceData {
                    tokens: seq.tokens[prompt.len()..seq.len() - 1].to_vec(),
                    logprobs: seq.logprobs[prompt.len()..seq.len() - 1].to_vec(),
                    alignment_data: seq.alignment_data[..seq.len() - 1].to_vec(),
                    new_tokens: seq.new_tokens.saturating_sub(1),
                };
                info!(
                    "\t {} {}",
                    self.tokenizer.decode(&seq.tokens[..seq.len() - 1])?,
                    new_seq.logprob_sum_normalized().exp()
                );
                last.push(new_seq);

                // peel of one token if it is a sentence sign
                let last_token_str = self
                    .tokenizer
                    .decode_single(seq.tokens[seq.len() - 2])
                    .unwrap();
                if prompt.len() < seq.len() - 2
                    && i == 0
                    && ".?,!".chars().any(|c| last_token_str.contains(c))
                {
                    let mut new_seq = SequenceData {
                        tokens: seq.tokens[prompt.len()..seq.len() - 2].to_vec(),
                        logprobs: seq.logprobs[prompt.len()..seq.len() - 2].to_vec(),
                        alignment_data: seq.alignment_data[..seq.len() - 2].to_vec(),
                        new_tokens: seq.new_tokens.saturating_sub(2),
                    };
                    let new_seq_len = new_seq.len();
                    if new_seq_len > 0 {
                        new_seq.logprobs[new_seq_len - 1] += 0.9f32.ln();
                    }
                    info!(
                        "\t {} {}",
                        self.tokenizer.decode(&seq.tokens[..seq.len() - 2])?,
                        new_seq.logprob_sum_normalized().exp(),
                    );
                    last.push(new_seq);
                }

                // peel of one word (because the last word is sometimes bullshit because it is cut of)
                if i == 0 {
                    let mut peel = 2;
                    loop {
                        if self
                            .tokenizer
                            .decode_single(seq.tokens[seq.len() - peel])
                            .unwrap()
                            .starts_with(" ")
                        {
                            break;
                        }
                        peel += 1;
                    }
                    if prompt.len() < seq.len() - peel {
                        let mut new_seq = SequenceData {
                            tokens: seq.tokens[prompt.len()..seq.len() - peel].to_vec(),
                            logprobs: seq.logprobs[prompt.len()..seq.len() - peel].to_vec(),
                            alignment_data: seq.alignment_data[..seq.len() - peel].to_vec(),
                            new_tokens: seq.new_tokens.saturating_sub(peel),
                        };
                        let new_seq_len = new_seq.len();
                        if new_seq_len != 0 {
                            new_seq.logprobs[new_seq_len - 1] += (0.5f32 / peel as f32).ln();
                        }

                        info!(
                            "\t {} {}",
                            self.tokenizer.decode(&seq.tokens[..seq.len() - peel])?,
                            new_seq.logprob_sum_normalized().exp(),
                        );
                        last.push(new_seq);
                    }
                }
            }
        }

        let audio_len_s = ar.len() as f32 / ar.sample_rate();
        let duration = start_time.elapsed().as_secs_f32();
        info!(
            "transcription of {audio_len_s:.2}s took {duration:.2}s ({:.2}x realtime)",
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
    /// returns the multiple possible sequences per beam
    pub fn transcribe_chunks(
        &mut self,
        x: &[(AudioChunkHandle, Vec<(Vec<i64>, Vec<f32>)>)],
        beam_width: usize,
    ) -> Result<Vec<Vec<SequenceData>>> {
        let start = Instant::now();
        let mut beams: Vec<(AudioChunkHandle, Vec<(SequenceHandle, SequenceData)>)> = Vec::new();
        for (chunk, prompts) in x {
            beams.push((
                chunk.clone(),
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
            let loop_start = Instant::now();
            let decoder_input: Vec<_> = beams
                .iter()
                .enumerate()
                .filter(|&(beam_idx, _)| finished[beam_idx].len() < beam_width)
                .flat_map(|(_, (chunk, beam))| {
                    beam.iter().map(|(seq, _)| (chunk.clone(), seq.clone()))
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

            let mut next_beams = Vec::new();
            let mut result_idx = 0;
            for (beam_idx, (chunk, beam)) in beams.iter().enumerate() {
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(usize, &SequenceHandle, i64, f32)> =
                    TopNVec::new(beam_width);
                let mut new_sequence_datas = vec![];
                for (seq, sequence_data) in beam.iter() {
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
                        best.insert(total_logprob, (result_idx, seq, token as i64, prob));
                    }

                    result_idx += 1;
                }

                for (score, (result_idx, seq, token, conf)) in best.data {
                    let next_seq = self.decoder.append_token_to_sequence(seq, token)?;
                    let mut next_sequence_data = new_sequence_datas[result_idx].clone();
                    next_sequence_data.tokens.push(token);
                    next_sequence_data.logprobs.push(conf.ln());

                    debug!(
                        "{} {}",
                        self.tokenizer.decode(&next_sequence_data.tokens)?,
                        score.exp()
                    );

                    if token as i64 == self.tokenizer.endoftext()
                        || next_sequence_data.len() >= Self::MAX_LEN
                    {
                        finished[beam_idx].push(next_sequence_data);
                    } else if score.exp() > best.max.exp() * 0.1 {
                        next_beam.push((next_seq, next_sequence_data));
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
