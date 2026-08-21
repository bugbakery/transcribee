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
import { DocumentMetadata, useDocumentsMetadata, WorkerTask } from '../util/use_tauri_event';
import { IoClose } from 'react-icons/io5';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { getAllWindows } from '@tauri-apps/api/window';
import { MenuBar } from '../menu';
import { Tooltip } from 'transcribee-ui-common/components/tooltip';
import { fileExplorerName } from '../utils/texts';
import { useEffect, useState } from 'react';
import { DoubleWidthModal, showModal } from 'transcribee-ui-common/components/modal';

export function HomePage() {
  const documents = useDocumentsMetadata((documents) => documents, []);

  const transcriptionQueueDocuments = documents.filter((doc) => !doc.save_path);
  const recentDocuments = documents.filter((doc) => doc.save_path);

  useEffect(() => {
    showModal(
      <DoubleWidthModal
        onClose={() => showModal(null)}
        label="Welcome to the First Alpha Version of Transcribee-Desktop"
      >
        <p className="pb-2">Hey,</p>
        <p className="pb-2">
          you are holding the very first alpha release of transcribee-desktop in your hands, a piece
          of software that we spend a lot of time developing and are very excited to share. Its
          still quite early, but we hope that transcribee can already be useful to you.
        </p>
        <p className="pb-2">
          Yet, please don&apos;t expect that everything works perfectly. This app cannot update
          automatically yet, so please check regularly if there is a new release. There are some
          things we know don&apos;t work well yet, and we are actively working on improving them.
          These include: the automatic transcription sometimes producing transcripts with
          unnescessary linebreaks, speaker identification, copy&paste in the transcript editor, and
          occasional hiccups on windows.
        </p>
        <p className="py-2">
          We are very interested in hearing about your experience and expectations with
          transcribee-desktop. We are happy to read from you via email at <MailLink /> and are
          actively looking for people to interview and to cooperate to find out more specifically
          what our users want. If you are interested in shaping in which direction we develop
          transcribee, please write us! If you have concrete problems (and a github account at
          hand), you can of course also{' '}
          <a
            className="underline"
            href="https://github.com/bugbakery/transcribee/issues"
            target="_blank"
            rel="noreferrer"
          >
            open an issue in our issue tracker
          </a>
          .
        </p>

        <div className="flex flex-col mt-2">
          <PrimaryButton onClick={() => showModal(null)}>Ok</PrimaryButton>
        </div>
      </DoubleWidthModal>,
    );
  }, []);

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

export function MailLink() {
  const address = 'ten.eebircsnart@tcatnoc';
  const [addressState, setAdress] = useState(null as null | string);
  useEffect(() => {
    setTimeout(() => {
      setAdress(address.split('').reverse().join(''));
    }, 100);
  }, []);

  return addressState ? (
    <a className="underline" href={`mailto:${addressState}`} target="_blank" rel="noreferrer">
      {addressState}
    </a>
  ) : (
    <span>xxxxxxx@xxxxxxxxxxx.xxx (Loading...)</span>
  );
}

function TranscriptionQueue({ documents }: { documents: DocumentMetadata[] }) {
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
                        text: 'Open Document',
                        action() {
                          invoke('open_document_window', { id: doc.id });
                        },
                      }),
                      await PredefinedMenuItem.new({
                        item: 'Separator',
                      }),
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

function RecentDocuments({ documents }: { documents: DocumentMetadata[] }) {
  return (
    <div className="w-full max-w-[500px] px-4 rounded-md">
      <h2 className="font-semibold text-center mb-2">Recent Documents</h2>
      <ul>
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="px-3 py-1.5 text-sm flex items-center even:bg-neutral-100 dark:even:bg-neutral-800 rounded-md justify-between group hover:underline cursor-pointer"
            onClick={() => {
              invoke('open_document_window', { id: doc.id });
            }}
            onContextMenu={async (e) => {
              e.preventDefault();
              const menu = await Menu.new({
                items: [
                  await MenuItem.new({
                    text: 'Open Document',
                    action() {
                      invoke('open_document_window', { id: doc.id });
                    },
                  }),
                  await PredefinedMenuItem.new({
                    item: 'Separator',
                  }),
                  await MenuItem.new({
                    text: `Reveal in ${fileExplorerName()}`,
                    async action() {
                      if (doc.save_path) {
                        revealItemInDir(doc.save_path);
                      }
                    },
                  }),
                ],
              });
              await menu.popup();
            }}
          >
            <div title={doc.save_path} className="truncate">
              {doc.display_name}
            </div>
            <IconButton
              icon={IoClose}
              label={'Remove Document from Recent List'}
              discreet
              className="hidden group-hover:block text-neutral-600 dark:text-neutral-400"
              onClick={async (e) => {
                e.stopPropagation(); // prevent opening document

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
