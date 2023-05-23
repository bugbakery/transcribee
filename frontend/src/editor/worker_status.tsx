import { useGetDocumentTasks } from '../api/document';
import { IconButton } from '../components/button';
import { Popup } from '../components/popup';
import { BsRobot } from 'react-icons/bs';
import clsx from 'clsx';
import React from 'react';
import { useMediaQuery } from '../utils/use_media_query';

type Task = ReturnType<typeof useGetDocumentTasks>['data'][0];

function formatProgress(task: Task | null): string | undefined {
  if (!task) return;
  if (task.is_completed) return 'DONE';
  else if (task.progress) return `${(task.progress * 100).toFixed(0)}%`;
  else if (task.assigned_at) return 'ASSIGNED';
  else return 'WAITING';
}

function getColor(task: Task | null, dark: boolean): string {
  const str = formatProgress(task);
  const color_map: Record<string, string> = dark
    ? {
        WAITING: '#ff9264',
        DONE: '#db93bd',
        DEFAULT: '#FFF',
      }
    : {
        WAITING: '#006d9b',
        DONE: '#246c42',
        DEFAULT: '#000',
      };
  return (str && color_map[str]) || color_map['DEFAULT'];
}

export function WorkerStatus({ documentId }: { documentId: string }) {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const { data } = useGetDocumentTasks({ document_id: documentId }, { refreshInterval: 1 });
  const isWorking = data?.some((task) => !task?.completed_at);

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
          label={`worker status (${isWorking ? 'working' : 'idle'})`}
          className={clsx({
            'animate-rainbow': data?.some((task) => !task?.completed_at),
          })}
        />
      }
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
