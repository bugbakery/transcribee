import argparse
import json
import re
from typing import List

from faster_whisper.tokenizer import _LANGUAGE_CODES
from faster_whisper.utils import _MODELS
from pydantic import BaseModel


def is_english_only(model_name):
    return model_name.endswith(".en")


class ModelConfig(BaseModel):
    id: str
    name: str
    languages: List[str]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=argparse.FileType("w"))
    args = parser.parse_args()

    model_configs = []
    multilingual_model_langs = list(sorted(_LANGUAGE_CODES))

    for model in _MODELS:
        if is_english_only(model):
            languages = ["en"]
        else:
            languages = ["auto"] + multilingual_model_langs

        model_configs.append(
            ModelConfig(
                id=model,
                name=re.sub(r"[^a-z0-9]", " ", model).title(),
                languages=languages,
            )
        )

    json.dump({x.id: x.dict() for x in model_configs}, args.out, indent=4)
    args.out.write("\n")
