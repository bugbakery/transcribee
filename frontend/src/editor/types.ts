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
  lang: string;
};

export type Document = {
  paragraphs: Paragraph[];
};
