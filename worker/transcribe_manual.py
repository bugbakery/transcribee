#!/usr/bin/env python
"""
A script for manually transcribing audio and outputting it in the transcribee datastructure
This might be handy for testing or other debugging work.
"""

import argparse
import asyncio
import logging
import pathlib
from concurrent.futures import ThreadPoolExecutor

from transcribee_proto.document import Document
from transcribee_worker.config import settings
from transcribee_worker.util import load_audio
from transcribee_worker.whisper_transcribe import transcribe_clean_async

logging.basicConfig(level=logging.INFO)


async def main():
    parser = argparse.ArgumentParser(
        description="Manually execute the transcription worker"
    )
    parser.add_argument("file", type=pathlib.Path, help="audio file")
    parser.add_argument("-l", "--lang", default="en", type=str, help="language")
    parser.add_argument("-m", "--model", default="tiny", type=str, help="whisper model")
    args = parser.parse_args()

    audio = load_audio(args.file)

    paragraphs = []
    with ThreadPoolExecutor() as executor:
        asyncio.get_running_loop().set_default_executor(executor)
        async for paragraph in transcribe_clean_async(
            data=audio,
            sr=settings.SAMPLE_RATE,
            start_offset=0,
            model_name=args.model,
            lang_code=(args.lang if args.lang != "auto" else None),
            progress_callback=None,
        ):
            paragraphs.append(paragraph)

    document = Document(children=paragraphs)
    print(document.json())


if __name__ == "__main__":
    asyncio.run(main())
