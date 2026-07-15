import { useEffect } from 'react';

export function useEvent<T extends Event>(type: string, callback: (e: T) => void) {
  useEffect(() => {
    const listener = (e: Event) => {
      callback(e as T);
    };

    window.addEventListener(type, listener);
    return () => {
      window.removeEventListener(type, listener);
    };
  }, [type, callback]);
}
