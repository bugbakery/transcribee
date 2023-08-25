import { RouteComponentProps } from 'wouter';
import { AppCenter } from '../components/app';
import ReactMarkdown from 'react-markdown';
import { getPage, useGetPage } from '../api/pages';
import { PageNotFoundPage } from './page_not_found';
import { LoadingPage } from './loading';

export function PagePage({ params: { pageId } }: RouteComponentProps<{ pageId: string }>) {
  const { data, error } = useGetPage({ page_id: pageId });
  if (error instanceof getPage.Error) {
    const err = error.getActualType();
    if (err.status === 404) {
      return <PageNotFoundPage />;
    }
  }
  if (!data) {
    return <LoadingPage />;
  }
  return (
    <AppCenter>
      <div>
        <ReactMarkdown className="prose dark:prose-invert">{data.text}</ReactMarkdown>
      </div>
    </AppCenter>
  );
}
