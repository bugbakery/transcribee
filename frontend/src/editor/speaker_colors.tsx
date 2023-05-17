import React, { useEffect, useState } from 'react';
import { Editor } from 'slate';

export const SpeakerColorsContext = React.createContext<Record<string, string>>({});

function getColor(n: number) {
  const hue = 230 + n * 137.5; // https://en.wikipedia.org/wiki/Golden_angle
  return `hsl(${hue}, ${Math.min(70 + n * 10, 100)}%, 75%)`;
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
