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
}: {
  tasks: Task[];
  waitingForDownload?: boolean;
}) {
  if (waitingForDownload) {
    return (
      <Tooltip
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={<span>waiting for model download</span>}
        className="ml-2"
      >
        <FaRegClock className="text-neutral-400 shrink-0" size={21} />
      </Tooltip>
    );
  } else if (tasks.some((t) => t.state == 'ABORTED' || t.state == 'FAILED')) {
    return (
      <Tooltip
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={<span>Automatic transcription did not complete!</span>}
        className="ml-2"
      >
        <IoIosCloseCircle className="text-red-600 shrink-0" size={21} />
      </Tooltip>
    );
  } else if (tasks.every((t) => t.state == 'NEW')) {
    return (
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
    const transcriptionProgress = calculateTranscriptionProgress(tasks);
    return (
      <Tooltip
        placement={'right'}
        fallbackPlacements={['bottom', 'top']}
        tooltipText={
          transcriptionProgress == 1
            ? `transcription done`
            : `transcription ${(transcriptionProgress * 100).toFixed(0)}%`
        }
        className="ml-2 tabular-nums"
      >
        <ProgressPie
          progress={transcriptionProgress}
          lineWidth={0.25}
          className="w-[21px] shrink-0"
        />
      </Tooltip>
    );
  }
}
