import asyncio
from typing import List

from transcribee_proto.document import Atom, Paragraph
from transcribee_worker.whisper_transcribe import combine_tokens_to_words


async def list_to_async_iter(list):
    for item in list:
        yield item


async def wrap_combine_tokens_to_words(input: List[Paragraph]):
    res = []
    async for x in combine_tokens_to_words(list_to_async_iter(input)):
        res.append(x)
    return res


def test_combine_tokens_to_words():
    input_para = Paragraph(
        type="paragraph",
        speaker=None,
        children=[
            Atom(
                text=" Will",
                start=0.0,
                end=0.33,
                conf=0.4493102431297302,
                conf_ts=0.0,
            ),
            Atom(
                text="kommen",
                start=0.33,
                end=0.82,
                conf=0.9989925026893616,
                conf_ts=0.008223438635468483,
            ),
            Atom(
                text=" zum",
                start=0.82,
                end=1.07,
                conf=0.9744400978088379,
                conf_ts=0.005903157405555248,
            ),
            Atom(
                text=" letzten",
                start=1.07,
                end=1.65,
                conf=0.9838394522666931,
                conf_ts=0.01149927917867899,
            ),
            Atom(
                text=" Token.",
                start=1.65,
                end=2.06,
                conf=0.9566531777381897,
                conf_ts=0.0096774036064744,
            ),
        ],
        lang="de",
    )

    output = list(asyncio.run(wrap_combine_tokens_to_words([input_para])))
    assert len(output) == 1
    (output_para,) = output
    assert output_para.children == [
        Atom(
            text=" Willkommen",
            start=0.0,
            end=0.82,
            conf=0.4493102431297302,
            conf_ts=0.0,
        ),
        Atom(
            text=" zum",
            start=0.82,
            end=1.07,
            conf=0.9744400978088379,
            conf_ts=0.005903157405555248,
        ),
        Atom(
            text=" letzten",
            start=1.07,
            end=1.65,
            conf=0.9838394522666931,
            conf_ts=0.01149927917867899,
        ),
        Atom(
            text=" Token.",
            start=1.65,
            end=2.06,
            conf=0.9566531777381897,
            conf_ts=0.0096774036064744,
        ),
    ]
