import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

/**
 * This hook is for subscribing to state from the rust side using a relatively simple convention:
 * It initially gets its data by calling the getFn and then subscribes to events named event.
 */
export function useTauriState<T>(getFn: () => Promise<T>, event: string, initial: T): T {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const unlisten = { current: () => {} };
    (async () => {
      setState(await getFn());
      unlisten.current = await listen<T>(event, (e) => setState(e.payload));
    })();
    return () => {
      unlisten.current();
    };
  }, [event]);
  return state;
}
