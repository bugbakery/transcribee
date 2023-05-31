import { RouteComponentProps, useLocation } from 'wouter';
import { IoIosArrowBack } from 'react-icons/io';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/button';
import { TranscriptionEditor } from '../editor/transcription_editor';
import { WorkerStatus } from '../editor/worker_status';
import { updateDocument, useGetDocument } from '../api/document';
import { TbFileExport } from 'react-icons/tb';
import { canGenerateVtt } from '../utils/export/webvtt';
import { Suspense, lazy, useMemo, useState, useCallback } from 'react';
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
import { BiPencil } from 'react-icons/bi';
import { SubmitHandler, useForm } from 'react-hook-form';

const LazyDebugPanel = lazy(() =>
  import('../editor/debug_panel').then((module) => ({ default: module.DebugPanel })),
);

type DocumentTitleInputs = {
  title: string;
};

function DocumentTitle({ name, onChange }: { name: string; onChange: (newTitle: string) => void }) {
  const [editable, setEditable] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DocumentTitleInputs>();

  const onSubmit: SubmitHandler<DocumentTitleInputs> = (data) => {
    setEditable(false);
    onChange(data.title);
  };

  const cancelEdit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement> | React.MouseEvent<HTMLButtonElement>) => {
      if ('key' in e) {
        if (e.key === 'Escape') {
          setEditable(false);
        }
      } else {
        setEditable(false);
      }
    },
    [],
  );

  const startEdit = useCallback(() => setEditable(true), []);

  if (name == null || name == undefined) {
    return <></>;
  }

  if (editable) {
    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-row space-x-2">
          <Input
            autoFocus
            defaultValue={name}
            className="py-0 px-4 text-xl font-bold min-w-0 !mt-0"
            onKeyPress={cancelEdit}
            {...register('title', {
              validate: {
                notWhitespace: (v) => v.trim().length > 0,
              },
            })}
          />
          <SecondaryButton type="button" onClick={cancelEdit} className="py-0">
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" className="py-0">
            Save
          </PrimaryButton>
        </div>
        {errors.title && (
          <p className="text-red-600 text-sm mt-1">{'Title must not be only whitespace'}</p>
        )}
      </form>
    );
  } else {
    return (
      <div>
        <IconButton
          icon={BiPencil}
          label="edit document title"
          onClick={startEdit}
          iconAfter={true}
          iconClassName="inline-block -mt-1"
          className="rounded-xl px-4 py-1"
        >
          <TopBarTitle className="mr-3 inline-block">{name}</TopBarTitle>
        </IconButton>
      </div>
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
      <TopBar className="!items-start">
        <TopBarPart className="sticky left-4 -ml-12 !items-start">
          <IconButton
            icon={IoIosArrowBack}
            label="back to document gallery"
            onClick={() => navigate('/')}
          />
          <DocumentTitle
            name={data?.name}
            onChange={(newTitle: string) => {
              mutate({ ...data, name: newTitle }, { revalidate: false });
              updateDocument({ document_id: documentId, name: newTitle })
                .catch((e) => {
                  console.error(e);
                  mutate(data);
                }) // reset to old name
                .then(() => mutate());
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
