import { useEffect } from 'react';

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
  lang: string;
};

export type Document = {
  children: Paragraph[];
  speaker_names: Record<number, string>;
};

// we fire this event when the user clicks on a word and we want the player to skip through it
const TEXT_CLICK_EVENT = 'textClick';
export class TextClickEvent extends CustomEvent<{ text: Text }> {
  constructor(text: Text) {
    super(TEXT_CLICK_EVENT, { detail: { text } });
  }
}
export function useOnTextClick(callback: (text: Text) => void) {
  useEffect(() => {
    const listener = (e: Event) => {
      const event = e as TextClickEvent;
      callback(event.detail.text);
    };

    window.addEventListener(TEXT_CLICK_EVENT, listener);
    () => {
      window.removeEventListener(TEXT_CLICK_EVENT, listener);
    };
  }, [callback]);
}
