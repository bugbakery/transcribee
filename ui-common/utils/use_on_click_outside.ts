import { useEvent } from './use_event';

export function useOnClickOutside(ref: HTMLElement | null, callback: (e: MouseEvent) => void) {
  useEvent<MouseEvent>('click', (e) => {
    if (ref && e.target && !ref.contains(e.target as Node)) {
      callback(e);
    }
  });

  return ref;
}
