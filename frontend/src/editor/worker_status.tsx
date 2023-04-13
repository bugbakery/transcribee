import { useGetDocumentTasks } from '../api/document';
import { IconButton } from '../components/button';
import { Popup } from '../components/popup';
import { BsRobot } from 'react-icons/bs';
import { operations } from '../openapi-schema';
import clsx from 'clsx';

function formatProgress(
  task?: operations['tasksTask']['responses']['200']['content']['application/json'],
): string | undefined {
  if (!task) return;
  if (task.completed_at) return 'DONE';
  else if (task.progress) return `${(task.progress * 100).toFixed(0)}%`;
  else if (task.assigned_at) return 'ASSIGNED';
  else return 'WAITING';
}

function getColor(
  task?: operations['tasksTask']['responses']['200']['content']['application/json'],
): string {
  const str = formatProgress(task);
  return (
    (str &&
      {
        WAITING: '#006d9b',
        DONE: '#246c42',
      }[str]) ||
    '#000'
  );
}

export function WorkerStatus({ documentId }: { documentId: string }) {
  const { data: dataWrongType } = useGetDocumentTasks({ id: documentId }, { refreshInterval: 1 });
  const data = dataWrongType as unknown as (typeof dataWrongType)[];
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
      className="background-white"
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
            <>
              {task?.dependency?.map((dependency) => {
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
                    stroke={getColor(data[dependencyIndex])}
                  />
                );
              })}
            </>
          );
        })}
        {data?.map((task, i) => {
          const ourY = yPositionsCircles[i];

          return (
            <>
              <circle cx={pointX} cy={ourY} r="4" fill={getColor(task)} />
              <text key={task?.id} x={pointX + 10} y={yPositionsText[i]} fill={getColor(task)}>
                {task?.task_type} {`(${formatProgress(task)})`}
              </text>
            </>
          );
        })}
      </svg>
    </Popup>
  );
}
