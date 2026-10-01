#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "torch", "openai-whisper", "numpy",
# ]
# ///

# this file uses the official whisper python implementation to generate reference intermediate 
# outputs to compare against in tests and check equivalence of the rust implementation at some
# points. It is called by the rust testsuite and generates a bunch of files in the target/ directory

from pathlib import Path
from sys import argv, stderr

import numpy as np
import torch
import whisper

target_dir = Path(__file__).parent.parent.parent / "target"

if __name__ == "__main__":
    if len(argv) != 2:
        print(f"usage: {argv[0]} [path/to/audio/file]", file=stderr)
        exit(-1)
    audio_file = argv[1]
    audio = whisper.audio.load_audio(audio_file)
    mel = whisper.audio.log_mel_spectrogram(audio, n_mels=128, padding=whisper.audio.N_SAMPLES)
    mel = whisper.audio.pad_or_trim(mel, whisper.audio.N_FRAMES)
    np.array(mel, dtype=np.float32).tofile(target_dir / "mel.f32")

    model = whisper.load_model('large-v3-turbo')
    mel = mel.unsqueeze(0)
    encoded = model.encoder(mel)
    encoded.detach().numpy().tofile(target_dir / "encoded.f32")

    n_audio = encoded.shape[0]
    tokenizer = whisper.tokenizer.get_tokenizer(multilingual=True)
    x = torch.tensor([[tokenizer.sot]] * n_audio)
    logits = model.logits(x, encoded)[:, 0]
    logits.detach().numpy().tofile(target_dir / "language_detect_logits.f32")
    mask = torch.ones(logits.shape[-1], dtype=torch.bool)
    mask[list(tokenizer.all_language_tokens)] = False
    logits[:, mask] = -np.inf
    language_tokens = logits.argmax(dim=-1)
    language_token_probs = logits.softmax(dim=-1).cpu()
    language_probs = [
        (c, language_token_probs[0, j].item())
        for j, c in zip(tokenizer.all_language_tokens, tokenizer.all_language_codes)
    ]
    language_probs.sort(key=lambda x: x[1])
    print(language_probs)