import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-location';
import clsx from 'clsx';

import { fetchApi } from '../api';

import PrimaryButton from '../components/PrimaryButton';

type Document = {
  id: string;
  name: string;
  audio_file: string | null;
  created_at: string;
  changed_at: string;
};

export default function HomePage() {
  const [documents, setDocuments] = useState<Document[] | null>(null);

  useEffect(() => {
    (async () => {
      const response = await fetchApi('v1/documents/', {});

      if (response.ok) {
        setDocuments(await response.json());
      }
    })();
  }, []);

  console.log(documents);

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-xl font-bold">transcribee</h1>
        <div>
          <PrimaryButton onClick={() => navigate('/login')}>Login</PrimaryButton>{' '}
          <PrimaryButton onClick={() => navigate('/new')}>New Document</PrimaryButton>
        </div>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-6">
        {documents?.map((doc) => {
          return (
            <li key={doc.id}>
              <Link
                to={`document?doc=${doc.id}`}
                className={clsx(
                  'block',
                  'h-40',
                  'p-4',
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
