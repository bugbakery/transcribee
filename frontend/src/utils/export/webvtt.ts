import { WebVtt, VttCue } from '@audapolis/webvtt-writer';
import { Document } from '../../editor/types';

export function generateWebVtt(doc: Document): WebVtt {
  const vtt = new WebVtt(
    'This file was generated using transcribee. Find out more at https://github.com/transcribee/transcribee',
  );
  for (const paragraph of doc.children) {
    if (paragraph.children.length === 0) {
      continue;
    }
    const start = paragraph.children[0].start;
    const end = paragraph.children[paragraph.children.length - 1].end;
    if (start === undefined || end === undefined) {
      continue;
    }
    const cue = new VttCue({
      startTime: start / 1e3,
      endTime: end / 1e3,
      payload: paragraph.children.map((x) => x.text).join(''),
    });
    vtt.add(cue);
  }
  return vtt;
}
