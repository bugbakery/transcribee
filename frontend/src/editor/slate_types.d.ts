import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';
import { Paragraph, Text } from './types';

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: Paragraph;
    Text: Text;
  }
}
