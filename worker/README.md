# transcribee-worker

a transcription worker for the transcribee open-source transcription platform

This component connects to the backend, picks up jobs and runs diarization / transcription / forced-alignment jobs.
It thus does all the CPU / GPU intense heavy lifting.

## Installation

We use pdm for dependency management. To install all dependencies locally, run:

```shell
pdm install
```

## Configuration

You can configure the worker by setting environment variables.
For a full list of those, see the attributes of the `Settings` class in `config.py`
Instead of setting environment variables, you can also specify them in the `.env`-file.
They will automatically be read from there.
See .env.example for an example of how this file could look.

The most important settings are explained here:

The worker needs multiple models, which will automatically be downloaded if they to not exist yet.
They will by default be stored in `./.data/models`.
You can change this directory by setting `MODELS_DIR`

The diarization models are downloaded from huggingface.
You need to accept the terms of the models first on [this page](https://hf.co/pyannote/speaker-diarization) and [this page](https://hf.co/pyannote/segmentation).
After that, go to [this page](https://hf.co/settings/tokens) and generate an access token.
This access token needs to be stored in the `HUGGINGFACE_TOKEN` setting.
Once the models are downloaded, this token is no longer needed.
