import glob
from pathlib import Path
from typing import List

import pytest
from pydantic import BaseModel, parse_file_as
from transcribee_proto.document import Paragraph
from transcribee_worker.whisper_transcribe import (
    move_space_to_prev_token,
    strict_sentence_paragraphs,
)


def doc_chain_func_to_list(*funcs):
    def wrapper(input: List[Paragraph]):
        res = []
        iter_ = iter(input)
        for func in funcs:
            iter_ = func(iter_)
        for x in iter_:
            res.append(x)
        return res

    return wrapper


class SpecInput(BaseModel):
    input: List[Paragraph]
    expected: List[Paragraph]


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_strict_sentence_paragraphs*.json"),
    ),
)
def test_strict_sentence_paragraphs(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = list(doc_chain_func_to_list(strict_sentence_paragraphs)(test_data.input))
    assert [x.text() for x in output] == [x.text() for x in test_data.expected]
    assert output == test_data.expected


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_move_space_to_prev_token*.json"),
    ),
)
def test_move_space_to_prev_token(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = doc_chain_func_to_list(move_space_to_prev_token)(test_data.input)
    assert output == test_data.expected


@pytest.mark.parametrize(
    "data_file",
    glob.glob(
        str(Path(__file__).parent / "data" / "test_space_and_sentences*.json"),
    ),
)
def test_space_and_sentences(data_file):
    test_data = parse_file_as(SpecInput, data_file)

    output = doc_chain_func_to_list(
        move_space_to_prev_token, strict_sentence_paragraphs
    )(test_data.input)
    for p in output:
        print(p.json())
    assert output == test_data.expected
