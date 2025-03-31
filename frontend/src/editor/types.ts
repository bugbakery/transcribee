import { Container, LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt';

export type Text = {
  text: string;
  start?: number;
  end?: number;
  conf?: number;
};

export type Paragraph = {
  type: 'paragraph';
  children: Text[];
  speaker: string | null;
  lang: string;
};

export type Document = {
  children: Paragraph[];
  speaker_names: Record<string, string>;
  version: number;
};

type ListToLoro<T> = T extends (infer Item)[] ? LoroList<ToLoro<Item>> : never;

type MapToLoro<T> = LoroMap<{
  [Property in keyof T]: ToLoro<T[Property]>;
}>;

type ScalarToLoro<T> = T extends string ? LoroText : T;
type ToLoro<T> = T extends Record<string, any> ? MapToLoro<T>
  : T extends Array<any>
  ? ListToLoro<T>
  : ScalarToLoro<T>;

export type RootedLoroDoc<T> = ToLoro<T> extends Container ? LoroDoc<{ root: ToLoro<T> }> : never;

export type EditorDocument = RootedLoroDoc<Document>;
export type LoroDocument = ToLoro<Document>;

// we fire this event when the user clicks on a word and we want the player to skip through it
export const SEEK_TO_EVENT = 'seekTo';
export class SeekToEvent extends CustomEvent<{ start?: number }> {
  constructor(start?: number) {
    super(SEEK_TO_EVENT, { detail: { start } });
  }
}
