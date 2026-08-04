import {
  IconButton,
  PrimaryButton,
  SecondaryButton,
} from 'transcribee-ui-common/components/button';
import { Tooltip } from 'transcribee-ui-common/components/tooltip';
import { invoke } from '@tauri-apps/api/core';
import { useTauriState } from '../util/use_tauri_event';
import { IoClose } from 'react-icons/io5';
import { FaRegClock } from 'react-icons/fa6';
import { clsx } from 'clsx';
import { ComponentProps } from 'react';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { getAllWindows } from '@tauri-apps/api/window';

type MediaFile = {
  content_type: string;
  tags: string[];
  url: string;
};
export type Document = {
  id: string;
  display_name: string;
  transcription_progress: number;
  save_path?: string;
  media_files: MediaFile[];
  has_unsaved_changes: boolean;
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
  documents.sort((a, b) => a.transcription_progress - b.transcription_progress);

  return (
    <div className="w-full max-w-[500px] px-4 pb-8">
      <h2 className="font-semibold text-center px-1 mb-4">Transcription Queue</h2>
      <div>
        {documents.map((doc) => {
          let progressIndicator;
          let contextMenuDeleteText;
          if (doc.transcription_progress == 0) {
            contextMenuDeleteText = 'Remove from Transcription Queue';
            progressIndicator = (
              <Tooltip
                placement={'right'}
                fallbackPlacements={['bottom', 'top']}
                tooltipText={
                  <span>
                    in queue <br />
                    (not started yet)
                  </span>
                }
                className="ml-2"
              >
                <FaRegClock className="text-neutral-400 shrink-0" size={21} />
              </Tooltip>
            );
          } else {
            if (doc.transcription_progress == 1) {
              contextMenuDeleteText = 'Delete Transcribed Document';
            } else {
              contextMenuDeleteText = 'Abort Transcription and Delete';
            }
            progressIndicator = (
              <Tooltip
                placement={'right'}
                fallbackPlacements={['bottom', 'top']}
                tooltipText={
                  doc.transcription_progress == 1
                    ? `transcription done`
                    : `transcription ${(doc.transcription_progress * 100).toFixed(0)}%`
                }
                className="ml-2"
              >
                <ProgressPie
                  progress={doc.transcription_progress}
                  lineWidth={0.25}
                  className="w-[21px] shrink-0"
                />
              </Tooltip>
            );
          }
          return (
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
              {progressIndicator}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressPie({
  progress,
  lineWidth,
  className,
  ...props
}: { progress: number; lineWidth: number } & ComponentProps<'svg'>) {
  const progressReal = Math.min(Math.max(progress, 0.1), 0.9999);
  const endX = Math.cos(progressReal * 2 * Math.PI - Math.PI / 2);
  const endY = Math.sin(progressReal * 2 * Math.PI - Math.PI / 2);

  const minXY = -1 - lineWidth;
  const wh = 2 + lineWidth * 2;

  return (
    <svg
      className={clsx(
        className,
        progress >= 1 ? 'text-green-600 dark:text-green-300' : 'text-black dark:text-white',
      )}
      viewBox={`${minXY} ${minXY} ${wh} ${wh}`}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={lineWidth}
      fill="none"
      {...props}
    >
      <path
        className="animate-[spin_3s_linear_infinite]"
        d={
          // circle segment according to progress
          `
          M ${endX} ${endY}
          A 1 1 0 ${progressReal > 0.5 ? 1 : 0} 0 0 -1
        `
        }
      />

      <circle r="1" opacity={0.1} />

      {progress >= 1 && (
        // checkbox:
        <path
          d={`
          M -0.42 0.1
          L -0.12 0.4
          L 0.47 -0.3
        `}
        />
      )}
    </svg>
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
