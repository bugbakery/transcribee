import { RouteComponentProps, useLocation } from 'wouter';
import { IoIosArrowBack } from 'react-icons/io';
import { ImPencil } from 'react-icons/im';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/button';
import { TranscriptionEditor } from '../editor/transcription_editor';
import { WorkerStatus } from '../editor/worker_status';
import { updateDocument, useGetDocument } from '../api/document';
import { TbFileExport } from 'react-icons/tb';
import { canGenerateVtt } from '../utils/export/webvtt';
import { Suspense, lazy, useMemo, useState } from 'react';
import { PlayerBar } from '../editor/player';
import { useDebugMode } from '../debugMode';
import clsx from 'clsx';
import { useAutomergeWebsocketEditor } from '../editor/automerge_websocket_editor';
import { WebvttExportModal } from '../editor/webvtt_export';
import { showModal } from '../components/modal';
import { Tooltip } from '../components/tooltip';
import { SpeakerColorsProvider } from '../editor/speaker_colors';
import { Version } from '../common/version';
import { Input } from '../components/form';

const LazyDebugPanel = lazy(() =>
  import('../editor/debug_panel').then((module) => ({ default: module.DebugPanel })),
);

function DocumentTitle({
  name,
  onSubmit,
}: {
  name: string;
  onSubmit: (event: React.FormEvent) => Promise<void>;
}) {
  const [editable, setEditable] = useState(false);

  if (editable) {
    return (
      <form
        className="flex flex-row space-x-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setEditable(false);
          onSubmit(e);
        }}
      >
        <TopBarTitle>
          <Input autoFocus name="document_name" defaultValue={name} />
        </TopBarTitle>
        <SecondaryButton type="button" onClick={() => setEditable(false)}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit">Save</PrimaryButton>
      </form>
    );
  } else {
    return (
      <>
        <TopBarTitle>{name}</TopBarTitle>
        <IconButton icon={ImPencil} label="edit name" onClick={() => setEditable(true)} />
      </>
    );
  }
}

export function DocumentPage({
  params: { documentId },
}: RouteComponentProps<{ documentId: string }>) {
  const { data, mutate } = useGetDocument({ document_id: documentId });
  const [_location, navigate] = useLocation();
  const debugMode = useDebugMode();

  const [syncComplete, setSyncComplete] = useState<boolean>(false);

  const url = new URL(`/api/v1/documents/sync/${documentId}/`, window.location.href);
  url.protocol = url.protocol.replace('http', 'ws');

  const authToken = localStorage.getItem('auth');
  url.searchParams.append('authorization', `Token ${authToken}`);
  const editor = useAutomergeWebsocketEditor(url, {
    onInitialSyncComplete: () => {
      setSyncComplete(true);
      const isNewDocument =
        editor.doc.version === undefined &&
        editor.doc.children === undefined &&
        editor.doc.speaker_names === undefined;
      if (!isNewDocument && editor.doc.version !== 1) {
        alert('The document is in an unsupported version.');
        navigate('/');
      }
    },
  });

  const canGenVtt = useMemo(() => canGenerateVtt(editor.doc.children), [editor.doc]);

  return (
    <AppContainer className="relative min-h-screen">
      <TopBar>
        <TopBarPart className="sticky left-4 -ml-12">
          <IconButton
            icon={IoIosArrowBack}
            label="back to document gallery"
            onClick={() => navigate('/')}
          />
          <DocumentTitle
            name={data?.name}
            onSubmit={async (e) => {
              const target = e.target as typeof e.target & {
                document_name: { value: string };
              };
              const name = target.document_name.value;
              await updateDocument({ document_id: documentId, name: name });
              mutate({ ...data, name: name });
            }}
          />
        </TopBarPart>
        <TopBarPart>
          <Tooltip tooltipText={canGenVtt.reason}>
            <IconButton
              icon={TbFileExport}
              label={'export...'}
              onClick={() => {
                showModal(<WebvttExportModal editor={editor} onClose={() => showModal(null)} />);
              }}
              disabled={!canGenVtt.canGenerate}
            />
          </Tooltip>
          <WorkerStatus documentId={documentId} />
          <MeButton />
        </TopBarPart>
      </TopBar>

      <SpeakerColorsProvider editor={editor}>
        <TranscriptionEditor editor={editor} className={clsx({ blur: !syncComplete })} />
      </SpeakerColorsProvider>

      <PlayerBar documentId={documentId} editor={editor} />

      <Suspense>{debugMode && <LazyDebugPanel editor={editor} />}</Suspense>

      <Version className="bottom-16" />
    </AppContainer>
  );
}
