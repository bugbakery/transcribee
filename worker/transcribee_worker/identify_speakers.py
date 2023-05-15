import logging
from typing import Callable

import numpy as np
import numpy.typing as npt
import torch
from sklearn.cluster import AgglomerativeClustering
from speechbrain.pretrained import EncoderClassifier
from transcribee_proto.document import Document
from transcribee_worker.util import alist, async_task

from .config import settings


async def identify_speakers(
    audio: npt.NDArray, doc: Document, progress_callback: Callable[[str, float], None]
):
    def work(queue):
        logging.info("Running Speaker Identification")

        if len(doc.children) == 0:
            return
        elif len(doc.children) == 1:
            doc.children[0].speaker = "1"
            return

        def time_to_sample(time: float | None):
            if time is None:
                raise ValueError("time may not be None")
            return max(min(int(time * settings.SAMPLE_RATE), len(audio)), 0)

        segments = [
            (
                time_to_sample(child.children[0].start),
                max(
                    time_to_sample(child.children[-1].end),
                    # we always use at least 0.1s,
                    # otherwise the fingerprinting model explodes sometimes
                    time_to_sample(child.children[0].start + 0.1),
                ),
            )
            for child in doc.children
        ]

        classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=settings.MODELS_DIR / "speechbrain-spkrec-ecapa-voxceleb",
        )
        if classifier is None:
            raise ValueError("classifier is None")

        embeddings = []
        for i, (start, end) in enumerate(segments):
            progress_callback("generating speaker embeddings", i / (len(segments) + 1))
            wav = audio[start:end]
            wav_tensor = torch.tensor(wav[np.newaxis, :])
            embedding = classifier.encode_batch(wav_tensor)
            embeddings.append(embedding[0, 0].detach().numpy())

        progress_callback(
            "clustering speaker embeddings", len(segments) / (len(segments) + 1)
        )
        clustering = AgglomerativeClustering(
            compute_full_tree=True,
            linkage="complete",
            n_clusters=None,
            # distance_threshold curtesty of
            # https://huggingface.co/pyannote/speaker-diarization/blob/369ac1852c71759894a48c9bb1c6f499a54862fe/config.yaml#L15
            distance_threshold=0.7153,
            metric="cosine",
        )
        clustering.fit(np.array(embeddings))

        # we now re-shuffle the labels so that the first occuring speaker is 0, the second is 1, ...
        label_map = {}
        for label in clustering.labels_:
            if label not in label_map:
                label_map[label] = str(len(label_map))

        for para, label in zip(doc.children, clustering.labels_):
            para.speaker = label_map[label]

    await alist(aiter(async_task(work)))
