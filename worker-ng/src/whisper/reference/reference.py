# this file uses the official whisper python implementation to generate reference intermediate
# outputs to compare against in tests and check equivalence of the rust implementation at some
# points. It is called by the rust testsuite and generates a bunch of files in the target/ directory

from pathlib import Path
from sys import argv, stderr

import numpy as np
import torch
import whisper
from whisper.tokenizer import Tokenizer

target_dir = Path(__file__).parent.parent.parent.parent / "target"

if __name__ == "__main__":
    if len(argv) != 2:
        print(f"usage: {argv[0]} [path/to/audio/file]", file=stderr)
        exit(-1)

    print("loading model...")
    model = whisper.load_model("large-v3-turbo")

    print("calculating mel spectrogram...")
    audio_file = argv[1]
    audio = whisper.audio.load_audio(audio_file)
    mel = whisper.audio.log_mel_spectrogram(audio, n_mels=128, padding=whisper.audio.N_SAMPLES)
    mel = whisper.audio.pad_or_trim(mel, whisper.audio.N_FRAMES)
    np.save(target_dir / "mel.npy", mel.numpy())

    print("running encoder...")
    mel = mel.unsqueeze(0)
    encoded = model.encoder(mel)
    np.save(target_dir / "encoded.npy", encoded.detach().numpy()[0])

    print("running decoder...")
    tokenizer: Tokenizer = whisper.tokenizer.get_tokenizer(multilingual=True, language="en", task="transcribe")
    tokens = list(tokenizer.sot_sequence_including_notimestamps)
    first = True
    while True:
        x = torch.tensor([tokens])
        logits = model.decoder(x, encoded)[0]
        logits[:, tokenizer.special_tokens["<|startoflm|>"]] = 0.0
        if first:
            logits[:, tokenizer.special_tokens["<|endoftext|>"]] = 0.0
        next_token = logits[-1].argmax().item()
        tokens.append(next_token)
        if tokens[-1] == tokenizer.eot:
            break
        first = False
    print("output:", tokenizer.decode(tokens))
    np.save(target_dir / "tokens.npy", np.array(tokens))
    np.save(target_dir / "logits.npy", logits.detach().numpy())

    print("done :)")
