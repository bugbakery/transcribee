import { useGetDocumentTasks } from '../api/document';
import { IconButton } from '../components/button';
import { Popup } from '../components/popup';
import { BsRobot } from 'react-icons/bs';
import clsx from 'clsx';
import React from 'react';
import { useMediaQuery } from '../utils/use_media_query';
import { RequestDataType } from '../api';

type Task = RequestDataType<typeof useGetDocumentTasks>[0];

function formatProgress(task: Task | null): string | undefined {
  if (!task) return;
  if (task.state == 'ASSIGNED' && task.current_attempt?.progress !== undefined)
    return `${(task.current_attempt?.progress * 100).toFixed(0)}%`;
  else return task.state;
}

function getColor(task: Task | null, dark: boolean): string {
  const str = formatProgress(task);
  const color_map: Record<string, string> = dark
    ? {
        NEW: '#ff9264',
        COMPLETED: '#db93bd',
        FAILED: '#f00',
        DEFAULT: '#FFF',
      }
    : {
        NEW: '#006d9b',
        COMPLETED: '#246c42',
        FAILED: '#f00',
        DEFAULT: '#000',
      };
  return (str && color_map[str]) || color_map['DEFAULT'];
}

export function getWorkerStatusString(isWorking: boolean, isFailed: boolean): string {
  if (isFailed) {
    return 'failed';
  } else if (isWorking) {
    return 'working';
  } else {
    return 'idle';
  }
}
export function WorkerStatus({ documentId }: { documentId: string }) {
  const { data } = useGetDocumentTasks({ document_id: documentId }, { refreshInterval: 1 });

  return <WorkerStatusWithData data={data !== undefined ? data : []} />;
}

function isSuperset<T>(set: Set<T>, subset: Set<T>) {
  for (const elem of subset) {
    if (!set.has(elem)) {
      return false;
    }
  }
  return true;
}

export function WorkerStatusWithData({ data: unsortedData }: { data: Task[] | undefined }) {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const data: Task[] = [];
  if (unsortedData !== undefined) {
    const unsortedDataCopy = [...unsortedData];
    const seenIds = new Set();
    while (unsortedDataCopy.length > 0) {
      const item = unsortedDataCopy.shift();
      if (!item) break;
      const dependencyIds = new Set(item.dependencies);
      if (isSuperset(seenIds, dependencyIds)) {
        data.push(item);
        seenIds.add(item.id);
      } else {
        unsortedDataCopy.push(item);
      }
    }
  }

  const isWorking = data?.some((task) => task.state !== 'COMPLETED');
  const isFailed = data?.some((task) => task.state == 'FAILED');

  const yPositionsText = data?.map((_, i) => i * 40 + 20);
  const yPositionsCircles = data?.map((_, i) => i * 40 + 14);
  const pointX = 30;
  const strokeProps = {
    strokeWidth: 3,
    fill: 'transparent',
  };

  return (
    <Popup
      button={
        <IconButton
          icon={BsRobot}
          label={`worker status (${getWorkerStatusString(isWorking, isFailed)})`}
          className={clsx({
            'animate-rainbow': isWorking && !isFailed,
            'text-red-500': isFailed,
          })}
        />
      }
      onClick={(e) => {
        e.preventDefault();
      }}
    >
      <span className="pl-7 font-bold">Worker Tasks</span>
      <svg className="py-2" height={Math.max(...(yPositionsText || [0])) + 30} width={250}>
        {data?.map((task, i) => {
          const ourY = yPositionsCircles[i];

          return (
            <React.Fragment key={task.id}>
              {task?.dependencies?.map((dependency) => {
                const dependencyIndex = data?.findIndex((task) => task?.id == dependency);
                const dependencyY = yPositionsCircles[dependencyIndex];

                const curvature = (i - dependencyIndex) * 10;
                const curvX = pointX - curvature;

                const path = `
                  M ${pointX} ${dependencyY}
                  C ${curvX}  ${dependencyY}
                    ${curvX}  ${ourY}
                    ${pointX} ${ourY}
                `;
                return (
                  <path
                    key={dependency}
                    d={path}
                    {...strokeProps}
                    stroke={getColor(data[dependencyIndex], systemPrefersDark)}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
        {data?.map((task, i) => {
          const ourY = yPositionsCircles[i];

          return (
            <React.Fragment key={task.id}>
              <circle cx={pointX} cy={ourY} r="4" fill={getColor(task, systemPrefersDark)} />
              <text x={pointX + 10} y={yPositionsText[i]} fill={getColor(task, systemPrefersDark)}>
                {task?.task_type} {`(${formatProgress(task)})`}
              </text>
            </React.Fragment>
          );
        })}
      </svg>
    </Popup>
  );
}
