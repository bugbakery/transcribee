<div align="center">
  <img height="100" src="doc/transcribee-logo.svg" alt="transcribee logo">
</div>

# <div align="center">🎤 transcribee ✍️</div>

> **<div align="center">an open source audio and video transcription software</div>**

> **Note**:
>
> While transcribee is certainly not "finished" or bug-free, it should be good enough for everyday transcription tasks.
> Please try it and [tell us how it goes](https://github.com/bugbakery/transcribee/issues/new)

`transcribee 🐝` aims to make the workflow for media transcription easier, faster and more accessible.

- It can **automatically generate a draft transcript** of your audio
- It allows you to **quickly improve** the automatic draft and fix any errors
- It's **collaborative** &ndash; split the work with your friends or colleagues
- It's **open-source**

## Try it Out!

There are now two versions of transcribee: transcribee desktop (an app you can install on your computer and that does all the processing locally) and transcribee web (a webapp that supports collaborative editing of documents and is intended for organizations and teams).

Transcribee can thus be currently tried out in different ways:
1. [Download the latest release of transcribee desktop](https://github.com/bugbakery/transcribee/releases) and run it on your computer.
1. You can [sign up for the beta instance of transcribee web that is hosted by us](https://about.transcribee.net/signup).
   This is the easiest way if you want to try transcribee web (or have a slow computer) and don't want to fiddle with the underlaying technology. In this case however your data will not be processed locally on your machine but rather on our server.
2. You can [self host transcribee web on your computer or a server](doc/web_self_hosting.md).
   This requires some technical knowledge to set up.

## Contributing

If you want to contribute, please first read our

* [Code Of Conduct](https://github.com/bugbakery/bugbakery/blob/main/CODE_OF_CONDUCT.md) and
* [Contributing Guidelines](https://github.com/bugbakery/bugbakery/blob/main/CONTRIBUTING.md)

## Develop!


To get started with developing transcribee desktop, follow the instructions
in the [README file for transcribee desktop](desktop/README.md).

To get started with developing or to try the current state of transcribee web, follow the instructions
in the [development setup document for transcribee web](doc/web_development_setup.md).

## How does it work?

Creating a transcript with transcribee 🐝 is done with the following steps:

1. Import your media file

   During import, your audio file is automatically converted to text using state-of-the-art models[^models].
   transcribee 🐝 also automatically detects different speakers in your file.

2. Manually improve the transcript

   After the automatic transcript is created, you can edit it to correct any mistakes the automatic transcription made.[^editor]
   You can also name the speakers.

   Since transcribee 🐝 is a collaborative software, you can do this step (and all other manual steps) together with others.
   All changes are instantly synced with everyone working on the transcript.


   > **Note**:
   >
   > Concurrent editing of transcripts is currently resulting in some very bad performance problems. See [#380](https://github.com/bugbakery/transcribee/issues/380)

3. Export

   Once you are happy with the transcript, you can export it.

[^models]: At the moment we use whisper for transcription and speechbrain for speaker identification.
[^editor]: The editor is based on slate with collaboration using the automerge CRDT.

## Acknowledgements

- Funded from March until September 2023 and from June until November 2026 by
  ![logos of the "Bundesministerium für Bildung und Forschung", Prototype Fund and Open Knowledge Foundation Deutschland](doc/pf_funding_logos.svg)
