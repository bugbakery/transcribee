import { BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';
import { HistoryEditor } from 'slate-history';
import { Paragraph, Text, Document } from './types';
import { LoroEditor } from './slate_loro';

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & LoroEditor<Document>;
    Element: Paragraph;
    Text: Text;
  }
}
