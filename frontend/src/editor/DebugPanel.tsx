import { Descendant } from 'slate';
import * as Y from 'yjs';
import { useDebugMode } from '../debugMode';

export default function DebugPanel({ value, yDoc }: { value: Descendant[]; yDoc: Y.Doc }) {
  const debugMode = useDebugMode();

  if (!debugMode) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 h-96 p-8">
      <textarea
        className="w-full h-full p-4 border-black border-2 shadow-brutal rounded-lg"
        value={JSON.stringify(value, undefined, 4)}
        onChange={() => undefined}
      ></textarea>
      <button
        className="absolute top-12 right-12 py-2 px-4 border-2 border-black text-sm font-medium rounded-md hover:bg-slate-100"
        onClick={() => {
          const update = Y.encodeStateAsUpdate(yDoc);
          Y.logUpdate(update);
        }}
      >
        Log update to console
      </button>
    </div>
  );
}
