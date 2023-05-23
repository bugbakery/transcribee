import React, { useEffect, useState } from 'react';
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

export function SpeakerColorsProvider({
  children,
  editor,
}: {
  children: JSX.Element;
  editor: Editor;
}) {
  const [colors, setColors] = useState<Record<string, string>>({});

  const paragraphs = editor.doc.children || [];
  const speakers = paragraphs.map((p) => p.speaker);

  useEffect(() => {
    const colors = Object.fromEntries([...new Set(speakers)].map((uuid, i) => [uuid, getColor(i)]));
    setColors(colors);
  }, [JSON.stringify(speakers)]);

  return <SpeakerColorsContext.Provider value={colors}>{children}</SpeakerColorsContext.Provider>;
}
