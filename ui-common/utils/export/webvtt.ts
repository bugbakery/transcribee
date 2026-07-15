import { WebVtt, VttCue, escapeVttString, formattedTime } from '@audapolis/webvtt-writer';
import { Document, Paragraph, Text } from '../../editor/types';
import { getSpeakerName } from '../document';

function atomToString(item: Text, includeWordTimings: boolean): string {
  if (includeWordTimings && typeof item.start === 'number') {
    console.log(item.text);
    return `<${formattedTime(item.start)}><c>${escapeVttString(String(item.text))}</c>`;
  } else {
    return escapeVttString(String(item.text));
  }
}

function createVttCue({
  cueStart,
  cueEnd,
  cuePayload,
  includeSpeakerNames,
  paragraph,
  speakerNames,
}: {
  cueStart: number;
  cueEnd: number;
  cuePayload: string;
  paragraph: Paragraph;
  includeSpeakerNames: boolean;
  speakerNames: Record<string, string>;
}) {
  if (cueStart >= cueEnd) {
    console.log(
      `found cueStart=${cueStart} that is not before cueEnd=${cueEnd}, fixing the end to be behind cueStart`,
    );
    cueEnd = cueStart + 0.02;
  }

  return new VttCue({
    startTime: cueStart,
    endTime: cueEnd,
    payload:
      (includeSpeakerNames && paragraph.speaker
        ? `<v ${escapeVttString(getSpeakerName(paragraph.speaker, speakerNames))}>`
        : '') + cuePayload,
    payloadEscaped: true,
  });
}

export function canGenerateVtt(paras: Paragraph[] | undefined): {
  canGenerate: boolean;
  reason: string;
} {
  if (paras === undefined) {
    return { canGenerate: false, reason: 'No document content' };
  }
  for (const para of paras) {
    let start = false;
    let end = false;
    for (const atom of para.children) {
      if (typeof atom.start === 'number') {
        start = true;
      }
      if (typeof atom.end === 'number') {
        end = true;
      }
    }
    if (!start || !end) {
      return {
        canGenerate: false,
        reason: 'Missing timings for at least one atom',
      };
    }
  }
  return {
    canGenerate: true,
    reason: '',
  };
}

function paragraphToCues(
  paragraph: Paragraph,
  includeWordTimings: boolean,
  includeSpeakerNames: boolean,
  maxLineLength: number | null,
  speaker_names: Record<string, string>,
): VttCue[] {
  const cues = [];
  let cuePayload = '';
  let cueLength = 0;
  let cueStart = null;
  let cueEnd = null;
  for (const atom of paragraph.children) {
    if (
      maxLineLength &&
      cueStart !== null &&
      cueEnd !== null &&
      cueLength + atom.text.length > maxLineLength
    ) {
      cues.push(
        createVttCue({
          cueStart,
          cueEnd,
          cuePayload,
          includeSpeakerNames,
          paragraph,
          speakerNames: speaker_names,
        }),
      );

      cuePayload = '';
      cueLength = 0;
      cueStart = null;
      cueEnd = null;
    }

    // This shouldn't be needed according to spec, but sometimes the timing is off
    // We correct this here instead of stopping the export
    if (atom.start && (cueStart === null || atom.start < cueStart)) {
      cueStart = atom.start;
    }
    if (atom.end && (cueEnd === null || atom.end > cueEnd)) {
      cueEnd = atom.end;
    }
    cuePayload += atomToString(atom, includeWordTimings);
    cueLength += atom.text.length;
  }

  if (cuePayload !== '') {
    if (cueStart === null || cueEnd === null) {
      throw Error(
        'Paragraph contains no timings, cannot generate cue(s). Make sure to only call this function if `canGenerateVtt` returns true',
      );
    }

    cues.push(
      createVttCue({
        cueStart,
        cueEnd,
        cuePayload,
        includeSpeakerNames,
        paragraph,
        speakerNames: speaker_names,
      }),
    );
  }
  return cues;
}

export function generateWebVtt(
  doc: Document,
  includeSpeakerNames: boolean,
  includeWordTimings: boolean,
  maxLineLength: number | null,
): WebVtt {
  const vtt = new WebVtt(
    'This file was generated using transcribee. Find out more at https://github.com/bugbakery/transcribee',
  );
  for (const paragraph of doc.children) {
    if (paragraph.children.length === 0) {
      continue;
    }
    for (const cue of paragraphToCues(
      paragraph,
      includeWordTimings,
      includeSpeakerNames,
      maxLineLength,
      doc.speaker_names,
    )) {
      vtt.add(cue);
    }
  }
  return vtt;
}
