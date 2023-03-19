export type Text = {
  text: string;
  start?: number;
  end?: number;
  conf?: number;
};

export type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: string;
  start?: number;
  end?: number;
};

export type Document = {
  lang: string;
  paragraphs: Paragraph[];
};
