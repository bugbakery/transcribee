import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';
import { HistoryEditor } from 'slate-history';
import { Paragraph, Text, Document } from './types';
import { AutomergeEditor } from 'slate-automerge-doc';

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor & AutomergeEditor<Document>;
    Element: Paragraph;
    Text: Text;
  }
}
