import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export type DocumentMetadata = {
  id: string;
  display_name: string;
  save_path?: string;
  media_files: MediaFile[];
  has_unsaved_changes: boolean;
  tasks: WorkerTask[];
};
export type MediaFile = {
  content_type: string;
  tags: string[];
  url: string;
};
export type WorkerTask = {
  id: string;
  task_type: 'IDENTIFY_SPEAKERS' | 'TRANSCRIBE' | 'REENCODE';
  state: 'NEW' | 'ASSIGNED' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  current_attempt: WorkerTaskAttempt | WorkerTaskAttemptDownloading | null;
};
export type WorkerTaskAttempt = {
  progress: number;
  step: string;
  timestamp: number;
  extra_data: null;
};
export type WorkerTaskAttemptDownloading = {
  progress: 0.0;
  step: 'TaskType.TRANSCRIBE:downloading_model';
  timestamp: number;
  extra_data: { download_model_loaded: number; download_model_total: number };
};

export function useDocumentMetadata<T>(
  documentId: string,
  selector: (document: DocumentMetadata) => T,
  initial: T,
): T {
  return useTauriState<DocumentMetadata>(
    async () => await invoke('get_document', { id: documentId }),
    `document_changed:${documentId}`,
  )(selector, initial);
}
export const useDocumentsMetadata = useTauriState<DocumentMetadata[]>(
  async () => await invoke('get_documents'),
  'documents_changed',
);

/**
 * This hook is for subscribing to state from the rust side using a relatively simple convention:
 * It initially gets its data by calling the getFn and then subscribes to events named event.
 */
export function useTauriState<TauriOutput>(getFn: () => Promise<TauriOutput>, event: string) {
  // this is curried because typescript does not support partial type inference and it would suck
  // to specify the selector type by hand

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Selector extends (tauriOutput: TauriOutput) => any>(
    selector: Selector,
    initial: ReturnType<Selector>,
  ) => {
    const [state, setState] = useState(initial);
    useEffect(() => {
      getFn().then((res) => setState(selector(res)));
      const unlistenPromise = listen<TauriOutput>(event, (e) => {
        const newVal = selector(e.payload);
        setState((prev) => {
          if (JSON.stringify(prev) == JSON.stringify(newVal)) {
            return prev;
          } else {
            return newVal;
          }
        });
      });

      return () => {
        unlistenPromise.then((unlisten) => unlisten());
      };
    }, [event]);
    return state;
  };
}
