import { useEvent } from './use_event';

export function useOnBlur(ref: HTMLElement | null, callback: () => void) {
  useEvent<MouseEvent>('click', (e) => {
    if (ref && e.target && !ref.contains(e.target as Node)) {
      callback();
    }
  });

  return ref;
}
