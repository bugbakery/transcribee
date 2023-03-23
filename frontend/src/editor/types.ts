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
  start?: number;
  end?: number;
  lang: string;
};

export type Document = {
  children: Paragraph[];
  speaker_names: Record<number, string>;
};
