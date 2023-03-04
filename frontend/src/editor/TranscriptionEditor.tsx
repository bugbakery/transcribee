import { useEffect, useMemo, useState } from 'react';
import { createEditor, Descendant, Transforms, Element, Editor } from 'slate';
import { withReact, Slate, Editable, RenderElementProps } from 'slate-react';
import * as Y from 'yjs';
import { withYjs, YjsEditor } from '@slate-yjs/core';
import DebugPanel from './DebugPanel';

const defaultElement: Element = {
  type: 'paragraph',
  speaker: 'Speaker 1',
  children: [{ text: '' }],
};

export function withNormalize<T extends Editor>(editor: T) {
  const { normalizeNode } = editor;

  // ensure editor always has at least one child
  editor.normalizeNode = (entry) => {
    const [node] = entry;
    if (!Editor.isEditor(node) || node.children.length > 0) {
      return normalizeNode(entry);
    }

    Transforms.insertNodes(editor, defaultElement, { at: [0] });
  };

  return editor;
}

function renderElement({ element, children }: RenderElementProps): JSX.Element {
  if (element.type === 'paragraph') {
    return (
      <div className="mb-6 flex">
        <div contentEditable={false} className="w-48 mr-8">
          {element.speaker}
        </div>
        {children}
      </div>
    );
  }

  throw Error('Unknown element type');
}

export default function TranscriptionEditor() {
  const [value, setValue] = useState<Descendant[]>([]);
  const yDoc = useMemo(() => new Y.Doc(), []);

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);

    const sharedRoot = yDoc.get('content', Y.XmlText) as Y.XmlText;
    const editorWithYjs = withYjs(editorWithReact, sharedRoot);

    const editorWithNormalization = withNormalize(editorWithYjs);
    return editorWithNormalization;
  }, []);

  useEffect(() => {
    YjsEditor.connect(editor);
    return () => YjsEditor.disconnect(editor);
  }, [editor]);

  return (
    <div>
      <Slate editor={editor} value={value} onChange={setValue}>
        <Editable renderElement={renderElement} />
      </Slate>
      <DebugPanel value={value} yDoc={yDoc} />
    </div>
  );
}
