import { useLayoutEffect, useState, RefObject } from 'react';
import { useResizeObserver } from './use_resize_observer';

export function useSize(target: RefObject<Element | null> | null) {
  const [size, setSize] = useState(target?.current?.getBoundingClientRect());

  useResizeObserver(
    target,
    (observedSize) => {
      setSize(observedSize);
    },
    [],
  );

  useLayoutEffect(() => {
    const t = target?.current;
    if (t) {
      setSize(t.getBoundingClientRect());
    }
  }, [target]);

  return size;
}
