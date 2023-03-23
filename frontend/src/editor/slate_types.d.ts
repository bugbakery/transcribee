import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';
import { Paragraph, Text } from './types';
import { AutomergeEditor } from 'slate-automerge-doc';

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & AutomergeEditor;
    Element: Paragraph;
    Text: Text;
  }
}
