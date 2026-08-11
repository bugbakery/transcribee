import {
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from 'transcribee-ui-common/components/button';
import {
  calculateTranscriptionProgress,
  ProgressPie,
  TranscriptionProgressIndicator,
} from 'transcribee-ui-common/components/transcription_progress';
import { invoke } from '@tauri-apps/api/core';
import { useTauriState } from '../util/use_tauri_event';
import { IoClose } from 'react-icons/io5';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { getAllWindows } from '@tauri-apps/api/window';
import { MenuBar } from '../menu';
import { Tooltip } from 'transcribee-ui-common/components/tooltip';

type MediaFile = {
  content_type: string;
  tags: string[];
  url: string;
};
export type Document = {
  id: string;
  display_name: string;
  save_path?: string;
  media_files: MediaFile[];
  has_unsaved_changes: boolean;
  tasks: WorkerTask[];
};

type WorkerTask = {
  id: string;
  task_type: 'IDENTIFY_SPEAKERS' | 'TRANSCRIBE' | 'REENCODE';
  state: 'NEW' | 'ASSIGNED' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  current_attempt: WorkerTaskAttempt | WorkerTaskAttemptDownloading | null;
};

type WorkerTaskAttempt = {
  progress: number;
  step: string;
  timestamp: number;
  extra_data: null;
};
type WorkerTaskAttemptDownloading = {
  progress: 0.0;
  step: 'TaskType.TRANSCRIBE:downloading_model';
  timestamp: number;
  extra_data: { download_model_loaded: number; download_model_total: number };
};

export function HomePage() {
  const documents = useTauriState<Document[]>(
    async () => await invoke('get_documents'),
    'documents_changed',
    [],
  );

  const transcriptionQueueDocuments = documents.filter((doc) => !doc.save_path);
  const recentDocuments = documents.filter((doc) => doc.save_path);

  return (
    <div className="min-h-full flex">
      <MenuBar
        hidden // only used for accelerators
        menus={[
          {
            title: 'File',
            items: [
              {
                text: 'Open Transcript…',
                accelerator: 'Ctrl+O',
                action: () => invoke('open_document_via_file_picker'),
              },
            ],
          },
        ]}
      />

      <div className="m-auto w-full flex flex-col items-center gap-4 pt-20 pb-16">
        <div className="flex max-w-[500px] w-full px-4 items-stretch justify-center gap-4 pb-12">
          <PrimaryButton
            className="grow basis-1"
            onClick={async () => {
              invoke('show_new_transcript_dialog');
            }}
          >
            Transcribe Audio
          </PrimaryButton>
          <SecondaryButton
            className="grow basis-1"
            onClick={async () => {
              await invoke('open_document_via_file_picker');
            }}
          >
            Open Transcribed File
          </SecondaryButton>
        </div>
        {transcriptionQueueDocuments.length > 0 && (
          <TranscriptionQueue documents={transcriptionQueueDocuments} />
        )}

        {recentDocuments.length > 0 && <RecentDocuments documents={recentDocuments} />}
      </div>
    </div>
  );
}

function TranscriptionQueue({ documents }: { documents: Document[] }) {
  documents.sort(
    (a, b) => calculateTranscriptionProgress(a.tasks) - calculateTranscriptionProgress(b.tasks),
  );

  return (
    <div className="w-full max-w-[500px] px-4 pb-8">
      <h2 className="font-semibold text-center px-1 mb-4">Transcription Queue</h2>
      <div>
        {documents.map((doc) => {
          let contextMenuDeleteText;
          if (doc.tasks.some((t) => t.state == 'ABORTED' || t.state == 'FAILED')) {
            contextMenuDeleteText = 'Remove Incomplete Document';
          } else if (doc.tasks.every((t) => t.state == 'NEW')) {
            contextMenuDeleteText = 'Remove From Transcription Queue';
          } else if (doc.tasks.every((t) => t.state == 'COMPLETED')) {
            contextMenuDeleteText = 'Delete Transcribed Document';
          } else {
            contextMenuDeleteText = 'Abort Transcription and Delete';
          }

          const downloadProgress = calculateDownloadProgress(doc.tasks);
          return (
            <>
              {downloadProgress && (
                <ModelDownloadProgress
                  key={`${doc.id}-download`}
                  downloadProgress={downloadProgress}
                />
              )}
              <div
                key={doc.id}
                className="px-3 py-2.5 my-2 border rounded-md flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                onClick={() => {
                  invoke('open_document_window', { id: doc.id });
                }}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  const menu = await Menu.new({
                    items: [
                      await MenuItem.new({
                        text: contextMenuDeleteText,
                        async action() {
                          if (await isDocumentOpen(doc.id)) {
                            await message(
                              'Document cannot be deleted while it is opened. Please close the document window first!',
                              { title: contextMenuDeleteText, kind: 'error' },
                            );
                            return;
                          }
                          const answer = await ask('Do you really want to delete the document?', {
                            title: contextMenuDeleteText,
                            kind: 'warning',
                          });
                          if (answer) {
                            invoke('forget_document', { id: doc.id });
                          }
                        },
                      }),
                      await MenuItem.new({
                        text: 'Open Document',
                        action() {
                          invoke('open_document_window', { id: doc.id });
                        },
                      }),
                    ],
                  });
                  await menu.popup();
                }}
              >
                <div title={doc.save_path} className="truncate text-sm">
                  {doc.display_name}
                </div>
                <TranscriptionProgressIndicator
                  tasks={doc.tasks}
                  waitingForDownload={downloadProgress != null}
                />
              </div>
            </>
          );
        })}
      </div>
    </div>
  );
}

function calculateDownloadProgress(tasks: WorkerTask[]) {
  const downloadTask = tasks.find(
    (task) => task.current_attempt?.step == 'TaskType.TRANSCRIBE:downloading_model',
  );

  if (!downloadTask || downloadTask?.current_attempt?.extra_data == null) {
    return null;
  } else {
    const data = downloadTask.current_attempt.extra_data;
    if (data.download_model_loaded == data.download_model_total) {
      return null;
    }
    return {
      progress: data.download_model_loaded / data.download_model_total,
      gb: data.download_model_total / 1e9,
    };
  }
}

function ModelDownloadProgress({
  downloadProgress: { gb, progress },
}: {
  downloadProgress: { progress: number; gb: number };
}) {
  return (
    <div className="px-3 py-2.5 my-2 rounded-md flex items-center justify-between bg-orange-50 dark:bg-orange-900">
      <div className="truncate text-sm">
        Downloading Transcription Model ({gb.toFixed(1)}&thinsp;GB)
      </div>
      <Tooltip
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={`${(progress * 100).toFixed(0)}%`}
        className="ml-2 tabular-nums"
      >
        <ProgressPie progress={progress} lineWidth={0.25} className="w-[21px] shrink-0" />
      </Tooltip>
    </div>
  );
}

function RecentDocuments({ documents }: { documents: Document[] }) {
  return (
    <div className="w-full max-w-[500px] px-4 rounded-md">
      <h2 className="font-semibold text-center mb-2">Recent Documents</h2>
      <ul>
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="px-3 py-1.5 text-sm flex items-center even:bg-neutral-100 dark:even:bg-neutral-800 rounded-md justify-between group hover:underline"
          >
            <div
              title={doc.save_path}
              onClick={() => {
                invoke('open_document_window', { id: doc.id });
              }}
              className="truncate cursor-pointer"
            >
              {doc.display_name}
            </div>
            <IconButton
              icon={IoClose}
              label={'Remove Document from Recent List'}
              discreet
              className="hidden group-hover:block text-neutral-600 dark:text-neutral-400"
              onClick={async () => {
                if (await isDocumentOpen(doc.id)) {
                  await message(
                    'Document cannot be removed from recent documents while it is opened. Please close the document window first!',
                    { title: 'Remove From Recent Documents', kind: 'error' },
                  );
                  return;
                }
                invoke('forget_document', { id: doc.id });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

async function isDocumentOpen(id: string) {
  for (const window of await getAllWindows()) {
    if (window.label == `document/${id}`) {
      return true;
    }
  }
  return false;
}
