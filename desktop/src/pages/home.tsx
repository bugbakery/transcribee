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
      <div className="my-auto flex flex-col w-full items-center margin-auto gap-4 pt-20">
        <div className="flex flex-row w-[500px] items-center justify-center gap-4 pb-12">
          <PrimaryButton
            className="block grow basis-1"
            onClick={async () => {
              invoke('show_new_transcript_dialog');
            }}
          >
            Transcribe Audio
          </PrimaryButton>
          <SecondaryButton
            className="block grow basis-1"
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
        <div className="pb-16" />
      </div>
    </div>
  );
}

function TranscriptionQueue({ documents }: { documents: Document[] }) {
  documents.sort((a, b) => a.transcription_progress - b.transcription_progress);

  return (
    <div className="w-[500px] pb-8">
      <h2 className="block font-semibold text-center px-1 mb-4">Transcription Queue</h2>
      <div className="relative -top-2">
        {documents.map((doc) => {
          console.log(doc);
          let progressIndicator;
          if (doc.transcription_progress == 0) {
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
                <FaRegClock className="text-gray-400 text-xl shrink-0" />
              </Tooltip>
            );
          } else {
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
              className="px-3 py-2.5 my-2 border rounded-md flex items-center justify-between hover:bg-gray-100 cursor-pointer"
              onClick={() => {
                invoke('open_document_window', { id: doc.id });
              }}
            >
              <div
                title={doc.save_path}
                className="whitespace-pre text-ellipsis overflow-hidden text-sm"
              >
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
      className={clsx(className, progress >= 1 ? 'text-green-600' : 'text-black')}
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
        mask="url(#myMask)"
        d={`
          M ${endX} ${endY}
          A 1 1 0 ${progressReal > 0.5 ? 1 : 0} 0 0 -1
        `}
      />

      <circle r="1" opacity={0.1} />

      {progress >= 1 && (
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
    <div className="w-[500px] rounded-md">
      <h2 className="font-semibold text-center mb-2">Recent Documents</h2>
      <ul>
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="px-3 py-1.5 text-sm flex items-center even:bg-gray-100 rouded-md justify-between group hover:underline"
          >
            <div
              title={doc.save_path}
              onClick={() => {
                invoke('open_document_window', { id: doc.id });
              }}
              className="whitespace-pre text-ellipsis overflow-hidden cursor-pointer"
            >
              {doc.display_name}
            </div>
            <IconButton
              icon={IoClose}
              label={'remove document from recent list'}
              discreet
              className="hidden group-hover:block text-gray-600"
              onClick={() => {
                invoke('forget_document', { id: doc.id });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
