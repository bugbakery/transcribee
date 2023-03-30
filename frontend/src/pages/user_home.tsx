import { Link } from 'wouter';
import clsx from 'clsx';

import { useListDocuments } from '../api/document';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { AppContainer } from '../components/app';

export function UserHomePage() {
  const { data } = useListDocuments({});

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
                  'block',
                  'p-4',
                  'aspect-square',
                  'bg-white',
                  'font-medium',
                  'rounded-lg',
                  'border',
                  'border-gray-200',
                  'hover:shadow-lg',
                  'hover:scale-105',
                  'transition-all',
                )}
              >
                {doc.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </AppContainer>
  );
}
