# transcribee v1 document Format Version 1

This document describes the first version of internal document format transcribee uses (named "transcribee v1 format" or "transcribee format" in the following text).
The format is an extension of the [transcribee format](./index.md).

This document contains a description of the content of a document in the transcribee v1 format (named "transcribee v1 document" in the following text).
It also contains restrictions / rules of the content.

The information in this document are sufficient to read / write a transcribee v1 document.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174](https://datatracker.ietf.org/doc/html/rfc8174) when, and only when, they appear in all capitals, as shown here.

## General

A transcribee v1 document consists of the following things:

1. paragraphs
2. speaker names

## Paragraphs

If a transcribee v1 document contains paragraphs, they MUST be stored in the `children` property of the transcribee v1 document as an array.
Each array element MUST have the following properties:

- `lang`: The `lang` MUST be a string or null. If not null, it MUST be an ietf language code. It MAY NOT be another value.
- `speaker`: The id of the speaker of the current paragraph. It MUST be a string or null. It MAY NOT be the empty string.
- `children`: The `children` MUST be an array of _text atoms_.
- `type`: MUST be set to the string `paragraph`

If the `speaker` is generated automatically, it SHOULD only be set if there is only one possible speaker for this paragraph.

### Text Atoms

A _text atom_ describes the smallest unit of text in a transcribee v1 document.
For example, a few characters of a word, a word of a group of words.
A _text atom_ MUST be an object with the following properties:

- `text`: The text associated with the audio snippet. It MUST be a string. It MAY NOT be the empty string. It MAY NOT contain a line terminator as [defined in ECMAScript](https://tc39.es/ecma262/#table-line-terminator-code-points). It MAY otherwise contain the entire range of unicode characters. Applications MAY choose to ignore or not render certain white space characters.
- `conf`: The confidence that the text matches the snippet. It MUST be a value in the inclusive range of 0 and 1, where 0 marks the lowest possible confidence and 1 marks the highest possible confidence. A text that was corrected by the user SHOULD have a confidence of 1.
- `conf_ts`: The confidence that the `start`/`end` properties are correct. It MUST be a value in the inclusive range of 0 and 1, where 0 marks the lowest possible confidence and 1 marks the highest possible confidence.
- `start`: The start of the `text` in the associated audio in seconds. It MUST be `null` or a floating point number. It MUST be `null` if and only if the `end` property is also `null`. If not `null`, it MUST be greater to or equal 0. If not `null`, it MUST be smaller than or equal to the `end` property.
- `end`: The end of the `text` in the associated audio in seconds. It MUST be `null` or a floating point number. It MUST be `null` if and only if the `start` property is `null`. If not `null`, it MUST be greater to or equal to the `start` property. If not `null`, it MUST be smaller than or equal to the total length of the associated audio.

## Speaker Names

A transcribee v1 document MAY contain a mapping of speaker ids to strings in the `speaker_names` property.
If this property exists, it MUST be an object.

Each key of this object MUST be an string representing a speaker id.
The speaker id SHOULD be used as a `speaker` of a paragraph in the transcribee v1 document.

Each value of this object MUST be a string.
It MAY NOT be the empty string.
It MAY NOT consist of only white space (as defined in [ECMAScript Section `TrimString`](https://tc39.es/ecma262/#sec-trimstring)).
It MAY otherwise contain the entire range of unicode characters.
There SHOULD NOT be two identical speaker names (i.e. the same value associated with two keys of the `speaker_names` object).

## Invariants

There are a number of restrictions / invariants that a transcribee v1 document MUST conform to.

Note: Some of them follow directly from the specification above but were deemed important enough to list them again here.

- The `start` property of the _text atom_ s is strictly increasing (ignoring atoms where `start` is null)
- The `start` and `end` property of a _text atom_ must either both be null or both be not-null: $\forall atom \in atoms: atom.start \neq null \iff atom.end \neq null$
- If `start` and `end` are set, `end` MUST be equal or larger than `start`: $\forall atom \in atoms: atom.start\neq null \implies atom.start \leq atom.end$

### Invalid Assumptions

There are a few assumptions that _seem_ valid at first glance, but do not hold for all cases.
The followling list contains some of them.
The list is not normative and may be extended at any time.

- For every point in time there is at least one atom: $\forall t \in [0, audio.length]: \exists atom \in atoms: (atom.start >= t) \wedge (atom.end <= t)$
- Every atom has a `start` and `end` that are not null

## Migration Instructions

As this is the first format version, no migration from a lower format is possible.
