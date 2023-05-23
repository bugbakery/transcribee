import { Link } from 'wouter';
import clsx from 'clsx';

import { deleteDocument, useListDocuments } from '../api/document';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';
import { AiOutlinePlus } from 'react-icons/ai';
import { IoMdTrash } from 'react-icons/io';
import { IconButton } from '../components/button';
import { Version } from '../common/version';
import { useAuthData } from '../utils/auth';

export function UserHomePage() {
  const { data, mutate } = useListDocuments({});
  const { isLoggedIn } = useAuthData();

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart>
          <TopBarTitle>transcribee</TopBarTitle>
        </TopBarPart>

        <TopBarPart>{isLoggedIn && <MeButton />}</TopBarPart>
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
