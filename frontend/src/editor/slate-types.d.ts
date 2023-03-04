import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';

type Text = {
  text: string;
  start?: number;
  end?: number;
  conf?: number;
};

type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: string;
  start?: number;
  end?: number;
};

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: Paragraph;
    Text: Text;
  }
}
