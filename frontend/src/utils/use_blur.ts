import { useRef } from 'react';
import { useEvent } from './use_event';

export function useOnBlur(ref: HTMLElement | null, callback: () => void) {
  // we need this terrible timeout hack because sometimes click events are fired, that are not on
  // the target. these are immidiately followed by the actual event
  const timeout = useRef<number | null>(null);

  useEvent<MouseEvent>('click', (e) => {
    if (ref && e.target) {
      if (ref.contains(e.target as Node)) {
        timeout.current && clearTimeout(timeout.current);
      } else {
        timeout.current = setTimeout(() => {
          callback();
        }, 10);
      }
    }
  });

  return ref;
}
