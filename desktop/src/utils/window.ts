import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';
import { RefObject, useLayoutEffect, useRef } from 'react';

export function useResizeWindowToElementHeight<T extends HTMLElement>(target: RefObject<T | null>) {
  const observer = useRef(
    new ResizeObserver(async (entries) => {
      const rect = entries[0].target.getBoundingClientRect();
      const currentWindow = getCurrentWindow();

      const scaleFactor = await currentWindow.scaleFactor();
      const windowSize = await currentWindow.innerSize();

      // tauri claims setSize sets the inner window size, but somehow it does not consider the title bar on macos
      const topPadding = (await currentWindow.isDecorated()) && platform() === 'macos' ? 28 : 0;

      windowSize.height = (rect.height + topPadding) * scaleFactor;
      currentWindow.setSize(windowSize);
    }),
  );

  useLayoutEffect(() => {
    const currentTarget = target.current;

    if (currentTarget) {
      observer.current.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.current.unobserve(currentTarget);
      }
    };
  }, [target]);
}
