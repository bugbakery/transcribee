import { useRef, useEffect, useState, useCallback } from 'react';
import { useSlateStatic } from 'slate-react';
import { Editor } from 'slate';
import { EditorDocument, LoroDocument } from '../editor/types';

export function getSpeakerName(
  speaker: string | null,
  doc: LoroDocument
): string {
  const speaker_names = doc.get("speaker_names");
  if (!speaker) {
    return `Unknown Speaker`;
  } else {
    const name = speaker_names.get(speaker)?.toString();
    return name ?? `Unnamed Speaker ${speaker}`
  }
}

export function useDocumentSelector<T>(
  selector: (doc: LoroDocument) => T,
  extra?: { eq?: (oldValue: T, newValue: T) => boolean; editor?: Editor },
) {
  const { editor, eq } = extra ?? {};
  const theEditor = editor ?? useSlateStatic();
  const [value, setValue] = useState(() => selector(theEditor._doc.getMap("root")));
  const valueRef = useRef(value);
  const theSelector = (doc: LoroDocument) => {
    const newValue = selector(doc);
    const update = eq !== undefined ? !eq(valueRef.current, newValue) : true;
    if (update) {
      valueRef.current = newValue;
      setValue(newValue);
    }
  };

  useEffect(() => {
    theSelector(theEditor._doc.getMap("root"));
    const cb = (doc: EditorDocument) => theSelector(doc.getMap("root"));
    theEditor.addDocChangeListener(cb);
    return () => theEditor.removeDocChangeListener(cb);
  }, [theEditor, theSelector]);

  return value;
}

export function useSpeakerName(speakerID: string | null, editor?: Editor) {
  return useDocumentSelector(
    useCallback(
      (doc: LoroDocument) => {
        const name = getSpeakerName(speakerID, doc);
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
    useCallback((doc) => {
      const spkNames: Record<string, string> = {};
      for (const para of doc.get("children").toArray()) {
        if (para.speaker !== null && !(para.speaker in spkNames)) {
          spkNames[para.speaker] = getSpeakerName(para.speaker, doc);
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
