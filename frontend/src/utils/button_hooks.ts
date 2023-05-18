import { useCallback, useRef } from 'react';

/**
 * A hook which distinguished between holding a button or clicking it.
 * When the button is hold it repeatedly fires a callback until the button is released.
 * `onShortClick` is not called when the button is hold.
 *
 * @returns the props to set on the button
 */
export function useButtonHoldRepeat({
  repeatingAction,
  onShortClick,
  delayMs,
  intervalMs = 100,
}: {
  repeatingAction: () => void;
  onShortClick?: () => void;
  delayMs?: number;
  intervalMs?: number;
}) {
  const interval = useRef<number | undefined>();

  const onLongPressStart = useCallback(() => {
    interval.current = setInterval(() => {
      repeatingAction();
    }, intervalMs);
  }, [repeatingAction, intervalMs]);

  const onLongPressStop = useCallback(() => {
    if (interval.current) {
      clearInterval(interval.current);
    }
  }, []);

  return useButtonLongPress({
    onLongPressStart,
    onLongPressStop,
    onShortClick,
    delayMs,
  });
}

/**
 * A hook which distinguished between long pressing a button or clicking it.
 *
 * @returns the props to set on the button
 */
export function useButtonLongPress({
  onLongPressStart,
  onLongPressStop,
  onShortClick,
  delayMs = 250,
}: {
  onLongPressStart?: () => void;
  onLongPressStop?: () => void;
  onShortClick?: () => void;
  delayMs?: number;
}): {
  onMouseDown: () => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
} {
  const longPressing = useRef(false);
  const timeout = useRef<number | undefined>();

  const down = useCallback(() => {
    timeout.current = setTimeout(() => {
      longPressing.current = true;
      onLongPressStart?.();
    }, delayMs);
  }, [onLongPressStart]);

  const up = useCallback(() => {
    if (timeout.current) {
      clearTimeout(timeout.current);
    }

    if (longPressing.current) {
      onLongPressStop?.();
    } else {
      onShortClick?.();
    }

    longPressing.current = false;
  }, [onLongPressStop, onShortClick]);

  const leave = useCallback(() => {
    if (timeout.current) {
      clearTimeout(timeout.current);
    }

    if (longPressing.current) {
      onLongPressStop?.();
    }

    longPressing.current = false;
  }, [onLongPressStop]);

  return {
    onMouseDown: down,
    onMouseUp: up,
    onMouseLeave: leave,
  };
}
