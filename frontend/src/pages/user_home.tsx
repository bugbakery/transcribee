import { Link } from 'wouter';
import clsx from 'clsx';

import { deleteDocument, useListDocuments } from '../api/document';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { AiOutlinePlus } from 'react-icons/ai';
import { IoMdTrash } from 'react-icons/io';
import { IconButton } from '../components/button';
import { Version } from '../common/version';
import { WorkerStatusWithData } from '../editor/worker_status';
import { useEffect, useState } from 'react';

type Tasks = ReturnType<typeof useListDocuments>['data'][0]['tasks'];

function getTaskProgress(tasks: Tasks) {
  if (tasks.length == 0) return 0;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.state == 'COMPLETED').length;
  const runningTasks = tasks
    .filter((task) => task.state == 'ASSIGNED')
    .map((task) => task.current_attempt?.progress || 0)
    .reduce((a, b) => a + b, 0);
  return (completedTasks + runningTasks) / totalTasks;
}

export function UserHomePage() {
  // Trusting the SWR documentation, we *should* be able to just set `refreshInterval` to a function
  // which is then called after new data is fetched to calculate the interval after which the next
  // data should be fetched. Sadly, this does not work, as SWR passed the stale data without an
  // indication if the data is stale :(
  // https://swr.vercel.app/docs/api#options
  // https://github.com/vercel/swr/blob/d1b7169adf01feaf47f46c556208770680680f6f/core/src/use-swr.ts#L643-L657
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const { data, mutate } = useListDocuments(
    {},
    {
      refreshInterval: refreshInterval,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    },
  );
  useEffect(() => {
    const hasUnfinishedDocuments = data?.some((doc) => getTaskProgress(doc.tasks) < 1);
    // Refresh every second if there are still unfinished documents to update the task progress
    // and every hour otherwise
    const refreshInterval =
      hasUnfinishedDocuments || hasUnfinishedDocuments === undefined ? 1 : 60 * 60;
    setRefreshInterval(refreshInterval * 1000);
  }, [data]);

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart>
          <TopBarTitle>transcribee</TopBarTitle>
        </TopBarPart>

        <TopBarPart>
          <MeButton />
        </TopBarPart>
      </TopBar>

      <ul
        className={clsx(
          'grid',
          'grid-cols-2',
          'sm:grid-cols-3',
          'md:grid-cols-4',
          'lg:grid-cols-5',
          'xl:grid-cols-6',
          'gap-6',
        )}
      >
        {data?.map((doc) => {
          return (
            <li key={doc.id}>
              <Link
                to={`document/${doc.id}`}
                className={clsx(
                  'w-full h-full',
                  'flex flex-col',
                  'items-stretch justify-between',
                  'p-4',
                  'aspect-square',
                  'bg-white dark:bg-neutral-900',
                  'font-medium',
                  'rounded-lg',
                  'border',
                  'border-gray-200 dark:border-neutral-600',
                  'hover:shadow-lg',
                  'hover:scale-105',
                  'transition-all',
                  'break-word',
                )}
              >
                <div className="w-full flex flex-row items-center justify-between relative">
                  {getTaskProgress(doc.tasks) < 1 ? (
                    <WorkerStatusWithData data={doc.tasks} />
                  ) : (
                    // we need to keep this div, because otherwise the trashbin jumps to the left
                    <div></div>
                  )}
                  <IconButton
                    label={'Delete Document'}
                    icon={IoMdTrash}
                    className={clsx('self-end -m-2')}
                    size={28}
                    onClick={(e) => {
                      e.preventDefault();
                      // TODO: Replace with modal
                      if (confirm(`Are you sure you want to delete ${doc.name}?`)) {
                        // mutate marks the document list as stale, so SWR refreshes it
                        deleteDocument({ document_id: doc.id }).then(() => mutate());
                      }
                    }}
                  />
                </div>
                {doc.name}
              </Link>
            </li>
          );
        })}

        <li>
          <Link
            title="create new document"
            aria-label="create new document"
            to={`/new`}
            className={clsx(
              'block',
              'p-4',
              'aspect-square',
              'bg-white dark:bg-neutral-900',
              'font-medium',
              'rounded-lg',
              'border',
              'border-gray-200 dark:border-neutral-600',
              'hover:shadow-lg',
              'hover:scale-105',
              'transition-all',
              'flex',
            )}
          >
            {' '}
            <AiOutlinePlus size={28} />
          </Link>
        </li>
      </ul>

      <Version />
    </AppContainer>
  );
}
