import { Link, useLocation } from 'wouter';
import clsx from 'clsx';

import PrimaryButton from '../components/PrimaryButton';
import { useListDocuments } from '../api/document';

export default function HomePage() {
  const [_, navigate] = useLocation();
  const { data } = useListDocuments({});

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-xl font-bold">transcribee</h1>
        <div>
          <PrimaryButton onClick={() => navigate('/login')}>Login</PrimaryButton>{' '}
          <PrimaryButton onClick={() => navigate('/new')}>New Document</PrimaryButton>
        </div>
      </div>
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
    </div>
  );
}
