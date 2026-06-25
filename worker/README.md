# transcribee-worker

a transcription worker for the transcribee open-source transcription platform

This component connects to the backend, picks up jobs and runs transcription / forced-alignment / speaker-identification jobs.
It thus does all the CPU / GPU intense heavy lifting.

## Installation

We use uv for dependency management. To install all dependencies locally, run:

```shell
uv sync --dev
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

### Transcription backends

By default transcription runs locally with whisper (`TRANSCRIPTION_BACKEND=whisper`).

As an opt-in alternative you can delegate transcription to the
[TwelveLabs](https://twelvelabs.io) Pegasus video-understanding model. This runs
server-side and requires no local model download. To enable it:

```shell
uv sync --extra pegasus            # installs the twelvelabs SDK
export TRANSCRIPTION_BACKEND=pegasus
export TWELVELABS_API_KEY=<your-key>   # free tier at https://twelvelabs.io
```

Relevant settings (see `config.py`):

- `TRANSCRIPTION_BACKEND` &ndash; `whisper` (default) or `pegasus`
- `TWELVELABS_API_KEY` &ndash; required when using the `pegasus` backend
- `PEGASUS_MODEL` &ndash; Pegasus model name (default `pegasus1.2`)
- `PEGASUS_INDEX_NAME` &ndash; TwelveLabs index used for indexing media (created on first use)

Pegasus is a video model, so audio-only media is automatically wrapped in a
minimal black video track (via `ffmpeg`) before indexing.
