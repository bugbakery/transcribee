import React, { useMemo } from 'react';
import { useSpeakerIDs } from '../utils/document';
import { Editor } from 'slate';

export const SpeakerColorsContext = React.createContext<Record<string, string>>({});

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

function SpeakerColorsProviderInner({
  children,
  editor,
}: {
  children: React.ReactNode;
  editor: Editor;
}) {
  const speakerIDs = useSpeakerIDs(editor);
  const colors = useMemo(() => {
    return Object.fromEntries([...speakerIDs].map((uuid, i) => [uuid, getColor(i)]));
  }, [speakerIDs]);

  return <SpeakerColorsContext.Provider value={colors}>{children}</SpeakerColorsContext.Provider>;
}

export function SpeakerColorsProvider({
  children,
  editor,
}: {
  children: React.ReactNode;
  editor: Editor | undefined;
}) {
  if (!editor)
    return <SpeakerColorsContext.Provider value={{}}>{children}</SpeakerColorsContext.Provider>;
  return <SpeakerColorsProviderInner editor={editor}>{children}</SpeakerColorsProviderInner>;
}
