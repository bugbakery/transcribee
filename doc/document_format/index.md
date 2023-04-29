# Transcribee Document Format

This document describes the internal document format used by transcribee (named "transcribee format" in the following text).

This document is a work in progress and some parts may change in the future.
However such changes SHOULD only consist of adding new versions in the `Content` section of this document.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174](https://datatracker.ietf.org/doc/html/rfc8174) when, and only when, they appear in all capitals, as shown here.

## General

A document in the transcribee format (named "transcribee document" in the following text) MAY be kept internally in different forms.
The canonical format is the JSON representation of an object with the keys described in this document.

Each transcribee document MUST have an associated audio.
This is the audio file the transcription was generated from.
While each document MUST only have exactly one audio, this audio may exist in different file formats at the same time (for example as part of a video, as a wave-file and as an mp3).
Keeping track of the associated audio and the media files is out of scope of this document.

## Versioning

A transcribee document MUST have a property named `version` which MUST contain an integer greater to or equal to `1`.
This integer describes the version of the transcribee format of the document.

When reading a transcribee document, the version MUST be checked.
If the file is in a version that is not supported by the reader, software SHOULD inform the user and refuse to read the file.

If the document reader encounters a document with a version lower than the highest version it supports, it SHOULD upgrade the version of the file.
If doing so, it MUST follow the migration instructions described in the newer file version specifications.

## Content

The remaining content of the document are as described in the version-specific specifications:

- [Version `1`](./document_format_v1.md)

## Examples

Example documents are provided for every version.
They are provided as text-files in JSON serialization.
You can find them in the [`examples`](./examples)-Folder.
Each file is named `v[VERSION]-[NAME].json`
