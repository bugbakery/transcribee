import { RouteComponentProps } from 'wouter';
import { useGetDocument } from '../api/document';
import TranscriptionEditor from '../editor/TranscriptionEditor';

export default function DocumentPage({ params }: RouteComponentProps<{ documentId: string }>) {
  const { data } = useGetDocument({ id: params.documentId });

  return (
    <div className="container p-6 mx-auto">
      <h2 className="text-2xl font-bold mb-8">{data?.name}</h2>
      <TranscriptionEditor documentId={params.documentId} />
    </div>
  );
}
