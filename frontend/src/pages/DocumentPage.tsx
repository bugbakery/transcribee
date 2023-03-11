import { RouteComponentProps } from 'wouter';
import TranscriptionEditor from '../editor/TranscriptionEditor';

export default function DocumentPage({ params }: RouteComponentProps<{ documentId: string }>) {
  return (
    <div className="container p-6 mx-auto">
      <h2 className="text-2xl font-bold mb-8">Test Editor</h2>
      <TranscriptionEditor documentId={params.documentId} />
    </div>
  );
}
