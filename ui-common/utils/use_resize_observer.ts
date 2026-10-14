import { useMemo, useLayoutEffect } from 'react';

export function useResizeObserver(
  target: Element | undefined | null,
  callback: (rect: DOMRect) => void,
) {
  const observer = useMemo(
    () =>
      new ResizeObserver(async (entries) => {
        const rect = entries[0].target.getBoundingClientRect();
        callback(rect);
      }),
    [callback],
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
}
