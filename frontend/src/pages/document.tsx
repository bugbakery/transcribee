import { RouteComponentProps, useLocation } from 'wouter';
import { IoIosArrowBack } from 'react-icons/io';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../components/top_bar';
import { AppContainer } from '../components/app_container';
import {
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from 'transcribee-ui-common/components/button';
import { TranscriptionEditor } from 'transcribee-ui-common/editor/transcription_editor';
import { WorkerStatus } from '../components/worker_status';
import { updateDocument, useGetDocument, useGetDocumentMediaFiles } from '../api/document';
import { TbFileExport, TbShare3 } from 'react-icons/tb';
import { Suspense, lazy, useState, useCallback } from 'react';
import { useDebugMode } from 'transcribee-ui-common/utils/debug_mode';
import { useAutomergeWebsocketEditor } from '../components/automerge_websocket_editor';
import { showModal } from 'transcribee-ui-common/components/modal';
import { Input } from 'transcribee-ui-common/components/form';
import { BiPencil } from 'react-icons/bi';
import { SubmitHandler, useForm } from 'react-hook-form';
import { Helmet } from 'react-helmet';
import { ShareModal } from '../components/share';
import { getDocumentWsUrl, useAuthData } from '../api/auth';
import { ExportModal } from 'transcribee-ui-common/editor/export/index';
import { PlayerBar } from 'transcribee-ui-common/editor/player';
import { minutesInMs } from 'transcribee-ui-common/utils/duration_in_ms';
import { Editor } from 'slate';

const LazyDebugPanel = lazy(() =>
  import('transcribee-ui-common/editor/debug_panel').then((module) => ({
    default: module.DebugPanel,
  })),
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
            onKeyDown={cancelEdit}
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
      <IconButton
        icon={BiPencil}
        label="edit document title"
        onClick={startEdit}
        iconAfter={true}
        className="rounded-xl px-4 py-1 flex min-w-0"
      >
        <TopBarTitle className="mr-3 inline-block">{name}</TopBarTitle>
      </IconButton>
    );
  }
}

export function DocumentPage({
  params: { documentId },
}: RouteComponentProps<{ documentId: string }>) {
  const { data, mutate } = useGetDocument({ document_id: documentId });
  const [_location, navigate] = useLocation();
  const debugMode = useDebugMode();
  const { isLoggedIn } = useAuthData();

  const url = getDocumentWsUrl(documentId);

  const [editor, initialValue] = useAutomergeWebsocketEditor(url, {
    onInitialSyncComplete: () => {
      if (!editor) return;

      const isNewDocument =
        editor.doc.version === undefined &&
        editor.doc.children === undefined &&
        editor.doc.speaker_names === undefined;
      if (!isNewDocument && editor.doc.version !== 2) {
        alert('The document is in an unsupported version.');
        navigate('/');
      }
    },
  });

  return (
    <AppContainer className="relative min-h-screen flex flex-col" versionClassName="mb-16">
      <Helmet>
        <title>{data?.name}</title>
      </Helmet>
      <TopBar className="!items-start z-40">
        <TopBarPart
          className={
            isLoggedIn ? 'sticky left-4 -ml-12 mr-10 !items-start grow basis-0 min-w-0' : ''
          }
        >
          {isLoggedIn && (
            <IconButton
              icon={IoIosArrowBack}
              label="back to document gallery"
              onClick={() => navigate('/')}
            />
          )}
          {data?.has_full_access ? (
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
          ) : (
            <TopBarTitle className="inline-block">{data?.name}</TopBarTitle>
          )}
        </TopBarPart>
        <TopBarPart>
          {data?.has_full_access && (
            <IconButton
              icon={TbShare3}
              label={'share...'}
              onClick={() => {
                showModal(<ShareModal documentId={documentId} onClose={() => showModal(null)} />);
              }}
            />
          )}
          {editor && (
            <IconButton
              icon={TbFileExport}
              label={'export...'}
              onClick={() => {
                showModal(
                  <ExportModal editor={editor} onClose={() => showModal(null)} document={data} />,
                );
              }}
            />
          )}
          <WorkerStatus documentId={documentId} />
          {isLoggedIn && <MeButton />}
        </TopBarPart>
      </TopBar>

      <TranscriptionEditor
        editor={editor}
        initialValue={initialValue}
        className={'grow flex flex-col'}
        readOnly={!data || !data.can_write}
      >
        <PlayerBarAutoMediaFiles documentId={documentId} editor={editor} />
      </TranscriptionEditor>

      {/* Spacer to prevent video preview from hiding text */}
      <div id="video-bottom-spacer" />

      {editor && debugMode && <Suspense>{<LazyDebugPanel editor={editor} />}</Suspense>}
    </AppContainer>
  );
}

function PlayerBarAutoMediaFiles({
  documentId,
  editor,
  onShowVideo,
}: {
  documentId: string;
  editor?: Editor;
  onShowVideo?: (show: boolean) => void;
}) {
  const { data: mediaFiles } = useGetDocumentMediaFiles(
    { document_id: documentId },
    {
      revalidateOnFocus: false,
      refreshInterval: minutesInMs(50), // media token expires after 1 hour
    },
  );

  if (editor && mediaFiles) {
    return (
      <PlayerBar
        documentId={documentId}
        editor={editor}
        mediaFiles={mediaFiles}
        onShowVideo={onShowVideo}
      />
    );
  }
}
