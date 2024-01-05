#!/usr/bin/env python3
import argparse
import sys
import tempfile
from asyncio import run
from zipfile import ZipFile

import automerge
import numpy as np
from transcribee_worker.identify_speakers import identify_speakers
from transcribee_worker.util import load_audio


async def main(args):
    z = ZipFile(args.infile, mode="r", allowZip64=True)
    for info in z.filelist:
        if "__MACOSX" not in info.filename:
            if info.filename.endswith(".automerge"):
                automerge_doc = info.filename
            elif info.filename.endswith(".mp3"):
                media_file = info.filename

    automerge_doc = automerge.load(z.read(automerge_doc))
    media_file = z.read(media_file)
    with tempfile.NamedTemporaryFile() as tmpfile:
        tmpfile.write(media_file)
        audio = load_audio(tmpfile.name)[0]

    with automerge.transaction(automerge_doc, "dummy") as doc:
        embeddings = await identify_speakers(
            args.number_of_speakers, audio, doc, lambda *args, **kwargs: ...
        )
    np.savez(args.outfile, np.stack(embeddings))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="run speaker identification for each paragraph in a document"
    )
    parser.add_argument(
        "--number_of_speakers",
        default=None,
        metavar="int",
        type=int,
        help="number of speakers",
    )
    parser.add_argument(
        "infile",
        default="export.zip",
        type=argparse.FileType("rb"),
        help="the transcribee export that should be considered",
    )
    parser.add_argument(
        "outfile",
        default=sys.stdout,
        type=argparse.FileType("wb"),
        help="file to write the output to",
    )

    args = parser.parse_args()

    run(main(args))

    args.outfile.close()
