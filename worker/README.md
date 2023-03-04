# transcribee-worker

a transcription worker for the transcribee open-source transcription platform

This component connects to the backend, picks up jobs and runs diarization / transcription / forced-alignment jobs.
It thus does all the CPU / GPU intense heavy lifting.


## Installation

We use pdm for dependency management. To install all dependencies locally, run:

```shell
pdm install
```
