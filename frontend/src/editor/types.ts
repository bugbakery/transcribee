export type Text = {
  text: string;
  start?: number;
  end?: number;
  conf?: number;
};

export type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: number | null;
  alternative_speakers: number[];
  lang: string;
};

export type Document = {
  children: Paragraph[];
  speaker_names: Record<number, string>;
};

// we fire this event when the user clicks on a word and we want the player to skip through it
export const TEXT_CLICK_EVENT = 'textClick';
export class TextClickEvent extends CustomEvent<{ text: Text }> {
  constructor(text: Text) {
    super(TEXT_CLICK_EVENT, { detail: { text } });
  }
}
