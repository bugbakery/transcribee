import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';

type Text = {
  text: string;
  startTs?: number;
  endTs?: number;
  confidence?: number;
};

type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: string;
  startTs?: number;
  endTs?: number;
};

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: Paragraph;
    Text: CustomText;
  }
}
