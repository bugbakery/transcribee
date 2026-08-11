import { RouteComponentProps } from 'wouter';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { withReact } from 'slate-react';
import { withAutomergeDoc } from 'slate-automerge-doc';
import { next as Automerge } from '@automerge/automerge';
import { Document, Paragraph } from 'transcribee-ui-common/editor/types';
import { migrateDocument } from 'transcribee-ui-common/editor/migrate_document';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { TranscriptionEditor } from 'transcribee-ui-common/editor/transcription_editor';
import { PlayerBar } from 'transcribee-ui-common/editor/player';
import { useDebugMode } from 'transcribee-ui-common/utils/debug_mode';
import { listen } from '@tauri-apps/api/event';
import { useTauriState } from '../util/use_tauri_event';
import { Document as DocumentOverview } from './home';
import { MenuBar } from '../menu';

function useAutomergeLocalFileEditor(documentId: string): [Editor?, Paragraph[]?] {
  const [editorAndInitialValue, setEditorAndInitialValue] = useState<null | {
    editor: Editor;
    initialValue: Paragraph[];
  }>(null);
  const editorRef = useRef<undefined | Editor>(undefined);
  if (editorRef.current !== editorAndInitialValue?.editor)
    editorRef.current = editorAndInitialValue?.editor;

  const sentChanges = useRef<Set<string>>(new Set());
  async function sendDocChange(newDoc: Document) {
    const lastChange = Automerge.getLastLocalChange(newDoc);
    if (lastChange) {
      const decoded = Automerge.decodeChange(lastChange);
      if (!sentChanges.current.has(decoded.hash)) {
        await invoke('append_automerge_change', lastChange, {
          headers: {
            id: documentId,
          },
        });
        sentChanges.current.add(decoded.hash);
      }
    }
  }

  useEffect(() => {
    let doc = Automerge.init();

    const createNewEditor = (doc: Automerge.Doc<Document>) => {
      const baseEditor = createEditor();
      const editorWithReact = withReact(baseEditor);
      const editor = withHistory(withAutomergeDoc(editorWithReact, Automerge.init()));
      editor.addDocChangeListener(sendDocChange);

      const migratedDoc = migrateDocument(doc as Automerge.Doc<Document>);
      sendDocChange(migratedDoc);
      editor.doc = migratedDoc;

      setEditorAndInitialValue((oldValue) => {
        oldValue?.editor.removeDocChangeListener(sendDocChange);
        const initialValue =
          migratedDoc.children !== undefined
            ? JSON.parse(JSON.stringify(migratedDoc.children))
            : [];
        return { editor: editor, initialValue: initialValue };
      });
    };

    const unlisten = { current: () => {} };
    (async () => {
      const document_bytes: ArrayBuffer = await invoke('read_automerge', { id: documentId });
      console.time('automerge load full doc');
      const newDoc = Automerge.load(new Uint8Array(document_bytes), { allowMissingChanges: true });
      console.timeEnd('automerge load full doc');
      doc = newDoc;
      createNewEditor(doc as Automerge.Doc<Document>);

      unlisten.current = await listen<{
        documentId: string;
        change: number[];
      }>(`automerge_change:${documentId}`, (e) => {
        const msg = new Uint8Array(e.payload.change);
        if (!editorRef.current) {
          return;
        }
        const [newDoc] = Automerge.applyChanges(editorRef.current.doc, [msg]);
        console.time('setDoc');
        HistoryEditor.withoutSaving(editorRef.current, () => {
          editorRef.current?.setDoc(newDoc);
        });
        console.timeEnd('setDoc');
      });
    })();

    return () => {
      unlisten.current();
    };
  }, [documentId, setEditorAndInitialValue]);

  return [editorAndInitialValue?.editor, editorAndInitialValue?.initialValue];
}

const LazyDebugPanel = lazy(() =>
  import('transcribee-ui-common/editor/debug_panel').then((module) => ({
    default: module.DebugPanel,
  })),
);

export function DocumentPage({
  params: { '*': documentId },
}: RouteComponentProps<{ '*': string }>) {
  const debugMode = useDebugMode();
  const [editor, initialValue] = useAutomergeLocalFileEditor(documentId);

  return (
    <div className="max-w-screen-xl p-6 mx-auto flex flex-col border-box">
      <MenuBar
        menus={[
          {
            title: 'File',
            items: [
              {
                text: 'New Window',
                accelerator: 'Ctrl+N',
                action: () => {
                  invoke('show_main_window');
                },
              },
              {
                text: 'Open Transcript…',
                accelerator: 'Ctrl+O',
                action: () => {
                  invoke('open_document_via_file_picker');
                },
              },
              {
                text: 'Save',
                accelerator: 'Ctrl+S',
                macOsMenuItemId: 'save',
                action: () => {
                  invoke('save_document', { id: documentId });
                },
              },
              {
                text: 'Save As…',
                accelerator: 'Shift+Ctrl+S',
                macOsMenuItemId: 'save_as',
                action: () => {
                  invoke('save_document_as_dialog', { id: documentId });
                },
              },
            ],
          },
          {
            title: 'Edit',
            items: [
              {
                text: 'Undo',
                accelerator: 'Ctrl+Z',
                macOsMenuItemId: 'undo',
                action: () => {
                  editor?.undo();
                },
              },
              {
                text: 'Redo',
                accelerator: 'Shift+Ctrl+Z',
                macOsMenuItemId: 'redo',
                action: () => {
                  editor?.redo();
                },
              },
            ],
          },
        ]}
      />

      <TranscriptionEditor
        editor={editor}
        initialValue={initialValue}
        className={'grow flex flex-col'}
        readOnly={false}
        disableUndoRedoHotkeys // handled by the menu
      >
        <PlayerBarWithMedia documentId={documentId} editor={editor} />
      </TranscriptionEditor>

      {/* Spacer to prevent video preview from hiding text */}
      <div id="video-bottom-spacer" />

      {editor && debugMode && <Suspense>{<LazyDebugPanel editor={editor} />}</Suspense>}
    </div>
  );
}

function PlayerBarWithMedia({
  documentId,
  editor,
}: {
  documentId: string;
  editor: Editor | undefined;
}) {
  const document = useTauriState<DocumentOverview>(
    async () => await invoke('get_document', { id: documentId }),
    `document_changed:${documentId}`,
    {
      id: '<unknown>',
      display_name: '',
      transcription_progress: 0,
      media_files: [],
      has_unsaved_changes: false,
    },
  );

  useEffect(() => {
    const changed_mark = document.has_unsaved_changes ? '*' : '';
    window.document.title = changed_mark + document.display_name;
  }, [document]);

  if (editor) {
    return (
      <PlayerBar
        documentId={documentId}
        editor={editor}
        mediaFiles={document.media_files.map((m) => ({
          ...m,
          url: convertFileSrc(m.url, 'media'),
        }))}
      />
    );
  }
}
