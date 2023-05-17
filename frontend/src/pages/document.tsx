import { RouteComponentProps, useLocation } from 'wouter';
import { IoIosArrowBack } from 'react-icons/io';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { IconButton } from '../components/button';
import { TranscriptionEditor } from '../editor/transcription_editor';
import { WorkerStatus } from '../editor/worker_status';
import { useGetDocument } from '../api/document';
import { TbFileExport } from 'react-icons/tb';
import { canGenerateVtt } from '../utils/export/webvtt';
import { Suspense, lazy, useState } from 'react';
import { PlayerBar } from '../editor/player';
import { useDebugMode } from '../debugMode';
import clsx from 'clsx';
import { useAutomergeWebsocketEditor } from '../editor/automerge_websocket_editor';
import { WebvttExportModal } from '../editor/webvtt_export';
import { showModal } from '../components/modal';

const LazyDebugPanel = lazy(() =>
  import('../editor/debug_panel').then((module) => ({ default: module.DebugPanel })),
);

export function DocumentPage({
  params: { documentId },
}: RouteComponentProps<{ documentId: string }>) {
  const { data } = useGetDocument({ document_id: documentId });
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
      if (editor.doc.version !== 1) {
        alert('The document is in an unsupported version.');
        navigate('/');
      }
    },
  });

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart className="sticky left-4 -ml-12">
          <IconButton
            icon={IoIosArrowBack}
            label="back to document gallery"
            onClick={() => navigate('/')}
          />
          <TopBarTitle>{data?.name}</TopBarTitle>
        </TopBarPart>
        <TopBarPart>
          <IconButton
            icon={TbFileExport}
            label={'export...'}
            onClick={() => {
              showModal(<WebvttExportModal editor={editor} onClose={() => showModal(null)} />);
            }}
            disabled={editor.doc.children === undefined || !canGenerateVtt(editor.doc.children)}
          />
          <WorkerStatus documentId={documentId} />
          <MeButton />
        </TopBarPart>
      </TopBar>

      <TranscriptionEditor editor={editor} className={clsx({ blur: !syncComplete })} />
      <PlayerBar documentId={documentId} editor={editor} />

      <Suspense>{debugMode && <LazyDebugPanel editor={editor} />}</Suspense>
    </AppContainer>
  );
}
