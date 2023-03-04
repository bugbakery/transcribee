#!/usr/bin/env python
"""
A script for manually transcribing audio and outputting it in the transcribee datastructure
This might be handy for testing or other debugging work.
"""

import logging
import sys

from transcribee_proto.document import Document, Paragraph
from transcribee_worker.torchaudio_align import align
from transcribee_worker.util import load_audio
from transcribee_worker.whisper_transcribe import transcribe

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"usage:\n\t{sys.argv[0]} lang_code path/to/audio.mp3")
        exit(-1)
    else:
        _, lang_code, audio_path = sys.argv

    audio = load_audio(audio_path)
    transcript = transcribe(audio, "tiny", lang_code)
    aligned_transcript = align(transcript, audio, lang_code)

    paragraph = Paragraph(speaker="speaker 1", children=transcript)
    document = Document(__root__=[paragraph])
    print(document.json())
