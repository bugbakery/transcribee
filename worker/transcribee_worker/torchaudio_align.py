""""
Forced Alignment with torchadio (Wav2Vec2)
modified from https://github.com/m-bain/whisperX/tree/main
Authors (among others): C. Max Bain
"""
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import torch
import torchaudio
from transcribee_proto.document import Document
from transcribee_worker.config import SAMPLE_RATE
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

LANGUAGES_WITHOUT_SPACES = ["ja", "zh"]

DEFAULT_ALIGN_MODELS_TORCH = {
    "en": "WAV2VEC2_ASR_BASE_960H",
    "fr": "VOXPOPULI_ASR_BASE_10K_FR",
    "de": "VOXPOPULI_ASR_BASE_10K_DE",
    "es": "VOXPOPULI_ASR_BASE_10K_ES",
    "it": "VOXPOPULI_ASR_BASE_10K_IT",
}

DEFAULT_ALIGN_MODELS_HF = {
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ar": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    "pl": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",
    "hu": "jonatasgrosman/wav2vec2-large-xlsr-53-hungarian",
    "fi": "jonatasgrosman/wav2vec2-large-xlsr-53-finnish",
    "fa": "jonatasgrosman/wav2vec2-large-xlsr-53-persian",
    "el": "jonatasgrosman/wav2vec2-large-xlsr-53-greek",
    "tr": "mpoyraz/wav2vec2-xls-r-300m-cv7-turkish",
}


@lru_cache()
def load_model(language_code: str, device):
    if language_code in DEFAULT_ALIGN_MODELS_TORCH:
        model_name = DEFAULT_ALIGN_MODELS_TORCH[language_code]
    elif language_code in DEFAULT_ALIGN_MODELS_HF:
        model_name = DEFAULT_ALIGN_MODELS_HF[language_code]
    else:
        raise ValueError(f"No align-model for language: {language_code}")

    if hasattr(torchaudio.pipelines, model_name):
        pipeline_type = "torchaudio"
        bundle = getattr(torchaudio.pipelines, model_name)
        align_model = bundle.get_model().to(device)
        labels = bundle.get_labels()
        align_dictionary = {c.lower(): i for i, c in enumerate(labels)}
    else:
        try:
            processor = Wav2Vec2Processor.from_pretrained(model_name)
            align_model = Wav2Vec2ForCTC.from_pretrained(model_name)
        except Exception as e:
            print(e)
            print(
                "Error loading model from huggingface. check "
                "https://huggingface.co/models for finetuned wav2vec2.0 models"
            )
            raise ValueError(
                f"The chosen align_model '{model_name}' could not be found in"
                " huggingface (https://huggingface.co/models) or torchaudio"
                " (https://pytorch.org/audio/stable/pipelines.html#id14)"
            )
        pipeline_type = "huggingface"
        align_model = align_model.to(device)
        labels = processor.tokenizer.get_vocab()
        align_dictionary = {
            char.lower(): code for char, code in processor.tokenizer.get_vocab().items()
        }

    align_metadata = {
        "language": language_code,
        "dictionary": align_dictionary,
        "type": pipeline_type,
    }

    return align_model, align_metadata


def interpolate_nans(x, method="nearest"):
    if x.notnull().sum() > 1:
        return x.interpolate(method=method).ffill().bfill()
    else:
        return x.ffill().bfill()


def align(
    transcript: Document,
    audio: np.ndarray | torch.Tensor,
    device="cpu",
    extend_duration: float = 2000.0,
) -> Document:
    """
    Force align phoneme recognition predictions to known transcription

    Parameters
    ----------
    transcript: Document
        The (coarsly) aligned transcript

    audio: np.ndarray | torch.Tensor
        The audio waveform

    device
        The pytorch device to use

    extend_duration: float
        Amount to pad input segments by in ms.

    Returns
    -------
    A Document with all Atoms force aligned. Atoms that could not be aligned using the
    Wav2Vec2 model are assigned timings to cover the end of the previous until the start
    of the next Atom with timings.
    """
    if transcript.is_empty():
        return transcript

    model, align_model_metadata = load_model(
        transcript.lang,
        device,
    )

    if not torch.is_tensor(audio):
        audio = torch.from_numpy(audio)
    if len(audio.shape) == 1:
        audio = audio.unsqueeze(0)

    MAX_DURATION = audio.shape[1] / SAMPLE_RATE

    model_dictionary = align_model_metadata["dictionary"]
    model_type = align_model_metadata["type"]

    # every character has
    # - a token index
    # - a start
    # - a stop

    # from the ctc model we only get the starts and stops for certain characters
    # for the rest we need to invent them
    #
    # For each atom we look at the time for the first and the last character.
    # If we have timings for these use them for the atom timing
    # If not use timing from adjacent characters
    #
    # We also fold word seperators into the Atoms (as whisper generates them as part of the Atoms)
    # We might want to consider not counting the word separator to the timing of a atom

    atom_index_to_timing_index = []
    tokens = []

    for atom in transcript.iter_atoms():
        start_index = None
        end_index = None

        for i, c in enumerate(atom.text):
            # TODO(robin): this is stupid hardcoding, lets do this better
            if c == " ":
                c = "|"

            c = c.lower()

            idx = None
            if c in model_dictionary:
                idx = len(tokens)
                tokens.append(model_dictionary[c])

            if i == 0:
                start_index = (idx, len(tokens) - 1 if idx is None else 2)
            if (i + 1) == len(atom.text):
                end_index = (idx, len(tokens))

        atom_index_to_timing_index.append((start_index, end_index))

    start = transcript.start() / 1e3
    end = transcript.end() / 1e3

    # if token level timestamps are disabled in the whisper layer
    # the timestamps are negative, so we don't know anything about
    # the timing and have to consider the full text
    if start < 0:
        start = 0

    if end < 0:
        end = MAX_DURATION

    # pad according original timestamps
    t1 = max(start - extend_duration, 0)
    t2 = min(end + extend_duration, MAX_DURATION)

    waveform_segment = audio[:, int(t1 * SAMPLE_RATE) : int(t2 * SAMPLE_RATE)]

    with torch.inference_mode():
        if model_type == "torchaudio":
            emissions, _ = model(waveform_segment.to(device))
        elif model_type == "huggingface":
            emissions = model(waveform_segment.to(device)).logits
        else:
            raise NotImplementedError(
                f"Align model of type {model_type} not supported."
            )
        emissions = torch.log_softmax(emissions, dim=-1)
    emission = emissions[0].cpu().detach()

    trellis = get_trellis(emission, tokens)
    path = backtrack(trellis, emission, tokens)

    char_segments = merge_repeats(path)

    conversion_factor = (
        (waveform_segment.size(1) / (trellis.size(0) - 1)) / SAMPLE_RATE * 1e3
    )

    for i, atom in enumerate(transcript.iter_atoms()):
        (start, last_end), (end, next_start) = atom_index_to_timing_index[i]

        if start is None:
            if last_end < 0:
                start_time = t1
            else:
                start_time = char_segments[last_end].end * conversion_factor
        else:
            start_time = char_segments[start].start * conversion_factor

        if end is None:
            if next_start not in char_segments:
                end_time = t2
            else:
                end_time = char_segments[next_start].start * conversion_factor
        else:
            end_time = char_segments[end].end * conversion_factor

        atom.start = start_time
        atom.end = end_time

    return transcript


"""
source: https://pytorch.org/tutorials/intermediate/forced_alignment_with_torchaudio_tutorial.html
"""


def get_trellis(emission, tokens, blank_id=0):
    num_frame = emission.size(0)
    num_tokens = len(tokens)

    # Trellis has extra diemsions for both time axis and tokens.
    # The extra dim for tokens represents <SoS> (start-of-sentence)
    # The extra dim for time axis is for simplification of the code.
    trellis = torch.empty((num_frame + 1, num_tokens + 1))
    trellis[0, 0] = 0
    trellis[1:, 0] = torch.cumsum(emission[:, 0], 0)
    trellis[0, -num_tokens:] = -float("inf")
    trellis[-num_tokens:, 0] = float("inf")

    for t in range(num_frame):
        trellis[t + 1, 1:] = torch.maximum(
            # Score for staying at the same token
            trellis[t, 1:] + emission[t, blank_id],
            # Score for changing to the next token
            trellis[t, :-1] + emission[t, tokens],
        )
    return trellis


@dataclass
class Point:
    token_index: int
    time_index: int
    score: float


def backtrack(trellis, emission, tokens, blank_id=0):
    # Note:
    # j and t are indices for trellis, which has extra dimensions
    # for time and tokens at the beginning.
    # When referring to time frame index `T` in trellis,
    # the corresponding index in emission is `T-1`.
    # Similarly, when referring to token index `J` in trellis,
    # the corresponding index in transcript is `J-1`.
    j = trellis.size(1) - 1
    t_start = torch.argmax(trellis[:, j]).item()

    path = []
    for t in range(t_start, 0, -1):
        # 1. Figure out if the current position was stay or change
        # Note (again):
        # `emission[J-1]` is the emission at time frame `J` of trellis dimension.
        # Score for token staying the same from time frame J-1 to T.
        stayed = trellis[t - 1, j] + emission[t - 1, blank_id]
        # Score for token changing from C-1 at T-1 to J at T.
        changed = trellis[t - 1, j - 1] + emission[t - 1, tokens[j - 1]]

        # 2. Store the path with frame-wise probability.
        prob = emission[t - 1, tokens[j - 1] if changed > stayed else 0].exp().item()
        # Return token index and time index in non-trellis coordinate.
        path.append(Point(j - 1, t - 1, prob))

        # 3. Update the token
        if changed > stayed:
            j -= 1
            if j == 0:
                break
    else:
        # failed
        return None
    return path[::-1]


# Merge the labels
@dataclass
class Segment:
    start: int
    end: int
    score: float

    def __repr__(self):
        return f"({self.score:4.2f}): [{self.start:5d}, {self.end:5d})"

    @property
    def length(self):
        return self.end - self.start


def merge_repeats(path):
    i1, i2 = 0, 0
    segments = {}
    while i1 < len(path):
        while i2 < len(path) and path[i1].token_index == path[i2].token_index:
            i2 += 1
        score = sum(path[k].score for k in range(i1, i2)) / (i2 - i1)
        segments[path[i1].token_index] = Segment(
            path[i1].time_index,
            path[i2 - 1].time_index + 1,
            score,
        )
        i1 = i2
    return segments
