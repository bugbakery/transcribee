import argparse
import json
import re
from typing import List

from pydantic import BaseModel
from transcribee_worker.torchaudio_align import (
    DEFAULT_ALIGN_MODELS_HF,
    DEFAULT_ALIGN_MODELS_TORCH,
)
from transcribee_worker.whisper_transcribe import get_context


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

    models = [
        "tiny.en",
        "tiny",
        "base.en",
        "base",
        "small.en",
        "small",
        "medium.en",
        "medium",
        "large-v1",
        "large",
    ]

    alignable_languages = set(DEFAULT_ALIGN_MODELS_HF.keys()) | set(
        DEFAULT_ALIGN_MODELS_TORCH.keys()
    )

    model_configs = []

    context = get_context("tiny")
    multilingual_model_langs = set(
        context.lang_id_to_str(i) for i in range(context.lang_max_id + 1)
    )

    for model in models:
        if is_english_only(model):
            languages = ["en"]
        else:
            languages = ["auto"] + list(
                sorted(multilingual_model_langs & alignable_languages)
            )

        model_configs.append(
            ModelConfig(
                id=model,
                name=re.sub(r"[^a-z0-9]", " ", model).title(),
                languages=languages,
            )
        )

    json.dump({x.id: x.dict() for x in model_configs}, args.out, indent=4)
    args.out.write("\n")
