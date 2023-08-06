import asyncio
import glob
from pathlib import Path
from typing import List

import pytest
from pydantic import BaseModel, parse_file_as
from transcribee_proto.document import Paragraph
from transcribee_worker.whisper_transcribe import (
    combine_tokens_to_words,
    move_space_to_prev_token,
    strict_sentence_paragraphs,
)


async def list_to_async_iter(list):
    for item in list:
        yield item


def async_doc_chain_func_to_list(*funcs):
    async def wrapper(input: List[Paragraph]):
        res = []
        iter = list_to_async_iter(input)
        for func in funcs:
            iter = func(iter)
        async for x in iter:
            res.append(x)
        return res

    return wrapper


class SpecInput(BaseModel):
    input: List[Paragraph]
    expected: List[Paragraph]


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_combine_tokens_to_words*.json"),
    ),
)
def test_combine_tokens_to_words(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = list(
        asyncio.run(
            async_doc_chain_func_to_list(combine_tokens_to_words)(test_data.input)
        )
    )
    assert output == test_data.expected


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_strict_sentence_paragraphs*.json"),
    ),
)
def test_strict_sentence_paragraphs(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = list(
        asyncio.run(
            async_doc_chain_func_to_list(strict_sentence_paragraphs)(test_data.input)
        )
    )
    assert output == test_data.expected


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_move_space_to_prev_token*.json"),
    ),
)
def test_move_space_to_prev_token(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = list(
        asyncio.run(
            async_doc_chain_func_to_list(move_space_to_prev_token)(test_data.input)
        )
    )
    assert output == test_data.expected


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_space_and_sentences*.json"),
    ),
)
def test_space_and_sentences(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = list(
        asyncio.run(
            async_doc_chain_func_to_list(
                move_space_to_prev_token, strict_sentence_paragraphs
            )(test_data.input)
        )
    )
    for p in output:
        print(p.json())
    assert output == test_data.expected
