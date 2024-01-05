import logging

import automerge
import numpy as np
import numpy.typing as npt
import torch
from spectralcluster import refinement, spectral_clusterer
from speechbrain.pretrained import EncoderClassifier
from transcribee_proto.document import Document
from transcribee_worker.types import ProgressCallbackType
from transcribee_worker.util import alist, async_task

from .config import settings

RefinementName = refinement.RefinementName
RefinementOptions = refinement.RefinementOptions
ThresholdType = refinement.ThresholdType
SymmetrizeType = refinement.SymmetrizeType
SpectralClusterer = spectral_clusterer.SpectralClusterer

ICASSP2018_REFINEMENT_SEQUENCE = [
    RefinementName.CropDiagonal,
    RefinementName.RowWiseThreshold,
    RefinementName.Symmetrize,
    RefinementName.Diffuse,
    RefinementName.RowWiseNormalize,
]

icassp2018_refinement_options = RefinementOptions(
    gaussian_blur_sigma=5,
    p_percentile=0.95,
    thresholding_soft_multiplier=0.05,
    thresholding_type=ThresholdType.RowMax,
    refinement_sequence=ICASSP2018_REFINEMENT_SEQUENCE,
)


async def identify_speakers(
    number_of_speakers: int | None,
    audio: npt.NDArray,
    doc: Document,
    progress_callback: ProgressCallbackType,
):
    def work(_queue):
        logging.info("Running Speaker Identification")

        if len(doc.children) == 0:
            return
        elif len(doc.children) == 1:
            doc.children[0].speaker = automerge.Text("1")
            return

        def time_to_sample(time: float | None):
            if time is None:
                raise ValueError("time may not be None")
            return max(min(int(time * settings.SAMPLE_RATE), len(audio)), 0)

        segments = [
            (
                min(
                    time_to_sample(child.children[0].start),
                    # we always use at least 0.1s,
                    # otherwise the fingerprinting model explodes sometimes
                    # since the start of the segment might be less than 0.1s
                    # from end of the audio, we use this as a safety
                    len(audio) - time_to_sample(0.1),
                ),
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
            progress_callback(
                step="generating speaker embeddings", progress=i / (len(segments) + 1)
            )
            wav = audio[start:end]
            wav_tensor = torch.tensor(wav[np.newaxis, :])
            embedding = classifier.encode_batch(wav_tensor)
            embeddings.append(embedding[0, 0].detach().numpy())

        progress_callback(
            step="clustering speaker embeddings",
            progress=len(segments) / (len(segments) + 1),
        )

        clusterer = SpectralClusterer(
            min_clusters=1 if number_of_speakers is None else number_of_speakers,
            max_clusters=100
            if number_of_speakers is None
            else number_of_speakers,  # TODO(robin): arbitrary upper limit
            autotune=None,
            laplacian_type=None,
            refinement_options=icassp2018_refinement_options,
            custom_dist="cosine",
        )

        labels = clusterer.predict(np.vstack(embeddings))

        # we now re-shuffle the labels so that the first occuring speaker is 1, the second is 2, ...
        label_map = {}
        for label in labels:
            if label not in label_map:
                label_map[label] = str(len(label_map) + 1)

        for para, label in zip(doc.children, labels):
            para.speaker = automerge.Text(label_map[label])

    return await alist(aiter(async_task(work)))
