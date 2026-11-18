type TextBase = {
  text: string;
  conf?: number;
  conf_ts?: number;
};

export type TextWithTs = TextBase & {
  start: number;
  end: number;
};

export type TextWithoutTs = TextBase & {
  start: null;
  end: null;
};

export type Text = TextWithTs | TextWithoutTs;

export type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: string | null;
  lang: string;
};

export type Document = {
  children: Paragraph[];
  speaker_names: Record<string, string>;
  version: number;
};

// we fire this event when the user clicks on a word and we want the player to skip through it
export const SEEK_TO_EVENT = 'seekTo';
export class SeekToEvent extends CustomEvent<{ start: number }> {
  constructor(start: number) {
    super(SEEK_TO_EVENT, { detail: { start } });
  }
}
