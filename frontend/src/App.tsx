import TranscriptionEditor from './editor/TranscriptionEditor';

export default function App() {
  return (
    <div>
      <div className="container p-8 mx-auto">
        <h2 className="text-2xl font-bold mb-8">Test Editor</h2>
        <TranscriptionEditor />
      </div>
    </div>
  );
}
