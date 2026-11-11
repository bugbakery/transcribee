import { useMemo, useLayoutEffect, useCallback } from 'react';

export function useResizeObserver(
  target: Element | undefined | null,
  callback: (rect: DOMRect) => void,
  deps: unknown[],
) {
  const memoizedCallback = useCallback(callback, deps);
  const observer = useMemo(
    () =>
      new ResizeObserver(async (entries) => {
        const rect = entries[0].target.getBoundingClientRect();
        memoizedCallback(rect);
      }),
    [memoizedCallback],
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
