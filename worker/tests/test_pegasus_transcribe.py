import os
from pathlib import Path

import pytest

from transcribee_worker.pegasus_transcribe import parse_pegasus_segments


def test_parse_pegasus_segments_basic():
    raw = (
        '{"segments": ['
        '{"start": 0.0, "end": 1.5, "text": "Hello there."},'
        '{"start": 1.5, "end": 3.0, "text": "How are you?"}'
        "]}"
    )
    paras = parse_pegasus_segments(raw, lang="en")
    assert [p.text() for p in paras] == ["Hello there.", "How are you?"]
    assert paras[0].children[0].start == 0.0
    assert paras[0].children[0].end == 1.5
    assert paras[0].lang == "en"


def test_parse_pegasus_segments_applies_offset():
    raw = '{"segments": [{"start": 0.0, "end": 2.0, "text": "Resumed."}]}'
    paras = parse_pegasus_segments(raw, lang="de", start_offset=10.0)
    assert paras[0].children[0].start == 10.0
    assert paras[0].children[0].end == 12.0


def test_parse_pegasus_segments_strips_fences_and_skips_empty():
    raw = (
        "Sure, here is the transcript:\n```json\n"
        '{"segments": ['
        '{"start": 0.0, "end": 1.0, "text": " trimmed "},'
        '{"start": 1.0, "end": 2.0, "text": ""}'
        "]}\n```"
    )
    paras = parse_pegasus_segments(raw, lang="en")
    assert len(paras) == 1
    assert paras[0].text() == "trimmed"


def test_parse_pegasus_segments_clamps_negative_duration():
    raw = '{"segments": [{"start": 5.0, "end": 4.0, "text": "oops"}]}'
    paras = parse_pegasus_segments(raw, lang="en")
    atom = paras[0].children[0]
    assert atom.start <= atom.end


def test_parse_pegasus_segments_rejects_non_json():
    with pytest.raises(ValueError):
        parse_pegasus_segments("I cannot do that.", lang="en")


@pytest.mark.skipif(
    not os.environ.get("TWELVELABS_API_KEY"),
    reason="TWELVELABS_API_KEY not set; skipping live Pegasus call",
)
def test_pegasus_transcribe_live():
    """End-to-end Pegasus transcription against the real API.

    Uploads the bundled sample clip and asserts we get back at least one
    non-empty timed paragraph. Slow (server-side processing), so it is gated
    on the API key being present.
    """
    import asyncio

    from transcribee_worker.pegasus_transcribe import transcribe_pegasus_async

    media = Path(__file__).parent / "data" / "sample.mp3"

    async def run():
        out = []
        async for para in transcribe_pegasus_async(
            media_path=media,
            start_offset=0.0,
            lang_code="en",
            progress_callback=None,
        ):
            out.append(para)
        return out

    paras = asyncio.run(run())
    assert paras, "expected at least one paragraph from Pegasus"
    assert paras[0].text().strip()
    assert paras[0].children[0].end >= paras[0].children[0].start
