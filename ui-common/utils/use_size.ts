import { useMemo, useLayoutEffect, useState } from 'react';

export function useSize(target: Element | undefined | null) {
  const [size, setSize] = useState(target?.getBoundingClientRect());

  const observer = useMemo(
    () =>
      new ResizeObserver(async (entries) => {
        const rect = entries[0].target.getBoundingClientRect();
        setSize(rect);
      }),
    [],
  );

  useLayoutEffect(() => {
    if (target) {
      observer.observe(target);
    }

    return () => {
      if (target) {
        observer.unobserve(target);
      }
    };
  }, [target, observer]);

  return size;
}
