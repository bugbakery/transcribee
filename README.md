# <div align="center">🎤 transcribee 🐝</div>

> **<div align="center">[going to be] an open source audio- and videotranscription software</div>**

> **Note**:
>
> Currently, transcribee is heavily work-in-progress and not yet ready for production use. Please come back in a few weeks / months.

`transcribee 🐝` aims to make the workflow for media transcription easier, faster and more accessible.

- It can **automatically generate a draft transcript** of your audio
- It allows you to **quickly improve** the automatic draft and fix any errors
- It's **collaborative** &ndash; split the work with your friends or colleagues
- It's **open-source**

## Develop!

To get started with developing or to try the current state of transcribee, follow the instructions
in the [development setup document](doc/development_setup.md).

## How does it work?

> **Note**:
>
> We're heavily working on transcribee. Not all steps described here are already implemented.

Creating a transcript with transcribee 🐝 is done with the following steps:

1. Import your media file

   During import, your audio file is automatically converted to text using state-of-the-art models[^models].
   transcribee 🐝 also automatically detects different speakers in your file.

2. Manually improve the transcript

   After the automatic transcript is created, you can edit it to correct any mistakes the automatic transcription made.[^editor]
   You can also name the speakers.

   Since transcribee 🐝 is a collaborative software, you can do this step (and all other manual steps) together with others.
   All changes are instantly synced with everyone working on the transcript.

3. Automatic re-alignment

   To make sure that the timestamps of your corrected text are still correct, transcribee 🐝 matches this text back up with the audio.

4. Manual re-alignment

   Now you can check the automatically generated timestamps and correct them.

5. Export

   Once you are happy with the transcript, you can export it.

[^models]: At the moment we use whisper.cpp for transcription, Wav2Vec2 for realignment and pyannote-audio for speaker diarization.
[^editor]: The editor is based on slate with collaboration using the automerge CRDT.

## Acknowledgements

- Funded from March 2023 until September 2023 by
  ![logos of the "Bundesministerium für Bildung und Forschung", Prototype Fund and Open Knowledge Foundation Deutschland](doc/pf_funding_logos.svg)
