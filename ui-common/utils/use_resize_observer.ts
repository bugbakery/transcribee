import { useMemo, useLayoutEffect, useCallback, RefObject } from 'react';

export function useResizeObserver(
  target: RefObject<Element | null> | undefined | null,
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
    const t = target?.current;
    if (t) {
      observer.observe(t);
    }

    return () => {
      if (t) {
        observer.unobserve(t);
      }
    };
  }, [target, observer]);
}
