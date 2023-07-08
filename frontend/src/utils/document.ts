import { useRef, useEffect, useState, useCallback } from 'react';
import { useSlateStatic } from 'slate-react';
import { Editor } from 'slate';
import { Document } from '../editor/types';

export function getSpeakerName(
  speaker: string | null,
  speaker_names: Record<string, string>,
): string {
  if (!speaker) {
    return `Unknown Speaker`;
  } else if (speaker in speaker_names) {
    return speaker_names[speaker];
  } else {
    return `Unnamed Speaker ${speaker}`;
  }
}

export function useDocumentSelector<T>(
  selector: (doc: Document) => T,
  extra?: { eq?: (oldValue: T, newValue: T) => boolean; editor?: Editor },
) {
  const { editor, eq } = extra ?? {};
  const theEditor = editor ?? useSlateStatic();
  const [value, setValue] = useState(() => selector(theEditor.doc));
  const valueRef = useRef(value);
  const theSelector = (doc: Document) => {
    const newValue = selector(doc);
    const update = eq !== undefined ? !eq(valueRef.current, newValue) : true;
    if (update) {
      valueRef.current = newValue;
      setValue(newValue);
    }
  };

  useEffect(() => {
    theSelector(theEditor.doc);
    theEditor.addDocChangeListener(theSelector);
    return () => theEditor.removeDocChangeListener(theSelector);
  }, [theEditor, theSelector]);

  return value;
}

const documentSelectorCache = {
  v: 0,
  cache: {} as Record<string, any>,
};

/**
 * Works the same as useDocumentSelector but the value of the selector is only recalculated
 * once per document change & key.
 * @param key the cache key (needs to be unique in the whole application)
 * @param selector the selector function
 * @param extra
 * @returns the value of the selector
 */
export function useDocumentSelectorCached<T>(
  key: string,
  selector: (doc: Document) => T,
  extra?: { eq?: (oldValue: T, newValue: T) => boolean; editor?: Editor },
) {
  const { editor, eq } = extra ?? {};
  const theEditor = editor ?? useSlateStatic();
  const [value, setValue] = useState(() => selector(theEditor.doc));
  const valueRef = useRef(value);

  useEffect(() => {
    const theSelector = (doc: Document) => {
      if (documentSelectorCache.v != theEditor.v) {
        documentSelectorCache.cache = {};
        documentSelectorCache.v = theEditor.v;
        console.info('invalidating', key);
      }

      if (!Object.prototype.hasOwnProperty.call(documentSelectorCache.cache, key)) {
        documentSelectorCache.cache[key] = selector(doc);
        console.info('re-evaluating', key);
      }

      const newValue = documentSelectorCache.cache[key];
      const update = eq !== undefined ? !eq(valueRef.current, newValue) : true;
      if (update) {
        valueRef.current = newValue;
        setValue(newValue);
      }
    };

    theSelector(theEditor.doc);
    theEditor.addDocChangeListener(theSelector);
    return () => theEditor.removeDocChangeListener(theSelector);
  }, [theEditor, selector]);

  return value;
}

export function useSpeakerName(speakerID: string | null, editor?: Editor) {
  const speakerNames = useSpeakerNames(editor);

  return speakerID && speakerNames[speakerID];
}

function compareJSON<T>(a: T, b: T) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useSpeakerNames(editor?: Editor): Record<string, string> {
  return useDocumentSelectorCached(
    'speakerNames',
    useCallback((newDoc) => {
      const spkNames: Record<string, string> = {};
      for (const para of newDoc.children) {
        if (para.speaker !== null && !(para.speaker in spkNames)) {
          spkNames[para.speaker] = getSpeakerName(para.speaker, newDoc.speaker_names);
        }
      }

      return spkNames;
    }, []),
    { eq: compareJSON, editor: editor },
  );
}

export function useSpeakerIDs(editor?: Editor) {
  return useDocumentSelectorCached(
    'speakerIDs',
    useCallback((newDoc) => {
      return [...new Set((newDoc.children || []).map((child) => child.speaker))].sort();
    }, []),
    { eq: compareJSON, editor: editor },
  );
}

export function useSpeakerColors(editor?: Editor) {
  return useDocumentSelectorCached(
    'speakerColors',
    useCallback((newDoc) => {
      const ids = [...new Set((newDoc.children || []).map((child) => child.speaker))].sort();
      return Object.fromEntries(ids.map((uuid, i) => [uuid, getColor(i)]));
    }, []),
    { eq: compareJSON, editor: editor },
  );
}

function getColor(n: number) {
  // palette is "Qualitative-Safe" from https://carto.com/carto-colors/
  const palette = [
    '#88CCEE',
    '#CC6677',
    '#DDCC77',
    '#117733',
    '#332288',
    '#AA4499',
    '#44AA99',
    '#999933',
    '#882255',
    '#661100',
    '#6699CC',
    '#888888',
  ];
  return palette[n % palette.length];
}

export type SpeakerBlocks = { start: number; end: number; speaker: string | null }[];
export function useSpeakerBlocks(editor?: Editor): SpeakerBlocks {
  return useDocumentSelectorCached(
    'speakerBlocks',
    useCallback((newDoc) => {
      if (!newDoc.children) return [];

      const blocks: SpeakerBlocks = [];
      newDoc.children.forEach((paragraph, i) => {
        if (blocks.length == 0) {
          blocks.push({ start: 0, end: -1, speaker: paragraph.speaker });
        } else if (blocks[blocks.length - 1].speaker != paragraph.speaker) {
          blocks[blocks.length - 1].end = i;
          blocks.push({ start: i, end: -1, speaker: paragraph.speaker });
        }
      });
      blocks[blocks.length - 1].end = newDoc.children.length - 1;
      return blocks;
    }, []),
    { eq: compareJSON, editor: editor },
  );
}
