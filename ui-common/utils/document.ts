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

export function useSpeakerName(speakerID: string | null, editor?: Editor) {
  return useDocumentSelector(
    useCallback(
      (doc: Document) => {
        const name = getSpeakerName(speakerID, doc.speaker_names);
        return name;
      },
      [speakerID],
    ),
    { editor: editor },
  );
}

function compareJSON<T>(a: T, b: T) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useSpeakerNames(editor?: Editor): Record<string, string> {
  return useDocumentSelector(
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
  return useDocumentSelector(
    useCallback((newDoc) => {
      return [...new Set((newDoc.children || []).map((child) => child.speaker))].sort();
    }, []),
    { eq: compareJSON, editor: editor },
  );
}
