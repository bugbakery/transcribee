import { clsx } from 'clsx';
import { ComponentProps } from 'react';
import { Tooltip } from './tooltip';
import { FaRegClock } from 'react-icons/fa6';
import { IoIosCloseCircle } from 'react-icons/io';

export function ProgressPie({
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

type Task = {
  task_type: 'IDENTIFY_SPEAKERS' | 'TRANSCRIBE' | 'REENCODE' | 'EXPORT';
  state: 'NEW' | 'ASSIGNED' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  current_attempt: { progress: number | null } | null;
};
export function calculateTranscriptionProgress(tasks: Task[]) {
  const weights = {
    IDENTIFY_SPEAKERS: 0.1,
    TRANSCRIBE: 2.0,
    REENCODE: 0.1,
    EXPORT: 0,
  };
  let numerator = 0;
  let denominator = 0;
  for (const task of tasks) {
    const weight = weights[task.task_type];
    let progress = 0.0;
    if (task.current_attempt && task.current_attempt.progress) {
      progress = task.current_attempt.progress;
    } else if (task.state == 'COMPLETED') {
      progress = 1.0;
    }
    numerator += weight * progress;
    denominator += weight;
  }
  return numerator / denominator;
}
export function TranscriptionProgressIndicator({
  tasks,
  waitingForDownload,
  size = 21,
  className,
  ...props
}: {
  tasks: Task[];
  waitingForDownload?: boolean;
  size?: number;
} & Partial<ComponentProps<typeof Tooltip>>) {
  if (waitingForDownload) {
    return (
      <Tooltip
        {...props}
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={<span>waiting for model download</span>}
        className={clsx('ml-2', className)}
      >
        <FaRegClock className="text-neutral-400 shrink-0" size={size} />
      </Tooltip>
    );
  } else if (tasks.some((t) => t.state == 'ABORTED' || t.state == 'FAILED')) {
    return (
      <Tooltip
        {...props}
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={<span>Automatic transcription did not complete!</span>}
        className={clsx('ml-2', className)}
      >
        <IoIosCloseCircle className="text-red-600 shrink-0" size={size} />
      </Tooltip>
    );
  } else if (tasks.some((t) => t.task_type == 'TRANSCRIBE' && t.state == 'NEW')) {
    return (
      <Tooltip
        {...props}
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={
          <span>
            in queue <br />
            (not started yet)
          </span>
        }
        className={clsx('ml-2', className)}
      >
        <FaRegClock className="text-neutral-400 shrink-0" size={size} />
      </Tooltip>
    );
  } else {
    const transcriptionProgress = calculateTranscriptionProgress(tasks);
    return (
      <Tooltip
        {...props}
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={
          transcriptionProgress == 1
            ? `transcription done`
            : `transcription ${(transcriptionProgress * 100).toFixed(0)}%`
        }
        className={clsx('ml-2 tabular-nums', className)}
      >
        <ProgressPie
          progress={transcriptionProgress}
          lineWidth={0.25}
          className="shrink-0"
          style={{ width: size }}
        />
      </Tooltip>
    );
  }
}

export function DocumentNotFinishedBanner({
  tasks,
  className,
  ...props
}: { tasks: Task[] } & ComponentProps<'div'>) {
  const hasUnfinishedSpeakerIdentification = tasks.some(
    (t) => (t.task_type == 'IDENTIFY_SPEAKERS' && t.state == 'NEW') || t.state == 'ASSIGNED',
  );
  const transcriptionProgress = calculateTranscriptionProgress(tasks);

  let message;
  if (tasks.every((t) => t.state == 'COMPLETED')) {
    return;
  } else if (tasks.some((t) => t.state == 'ABORTED')) {
    message = (
      <p>
        The automatic transcription of this document was aborted. This happens when transcribee is
        quit while transcription jobs are running. You can still use and edit this document, but you
        might want to delete it and start anew.
      </p>
    );
  } else if (tasks.some((t) => t.state == 'FAILED')) {
    message = (
      <p>
        The automatic transcription of this document failed. You can still use and edit this
        document, but you might want to delete it and start anew.
      </p>
    );
  } else if (tasks.some((t) => t.task_type == 'TRANSCRIBE' && t.state == 'NEW')) {
    message = (
      <p>
        The automatic transcription for this document is currently queued. It will start when the
        preceding documents are done processing.
      </p>
    );
  } else {
    message = (
      <>
        <p>
          The automatic transcription for this document is in progress (
          {(transcriptionProgress * 100).toFixed(0)}%).
        </p>
        <p>
          You can already start to correct and edit the parts of the transcript that are processed.
        </p>

        {hasUnfinishedSpeakerIdentification && (
          <p className="pt-3">
            Speaker identification happens when automatic transcription is finished. All speaker
            assignments that you make before the automatic speaker identification is run will be
            overwritten.
          </p>
        )}
      </>
    );
  }

  return (
    <div
      {...props}
      className={clsx(
        'p-6 rounded-lg mb-10 max-w-4xl mx-auto flex gap-6 justify-center items-center bg-orange-50/50 dark:bg-orange-200/20 border border-orange-200 dark:border-orange-200/50',
        className,
      )}
    >
      <TranscriptionProgressIndicator tasks={tasks} size={60} disableTooltip />

      <div className="h-fit">{message}</div>
    </div>
  );
}
