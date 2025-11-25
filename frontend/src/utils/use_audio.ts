import { actions, video, events, props } from '@podlove/html5-audio-driver';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { padRect, rectContains } from './rect_utils';

type UseAudioOptions = {
  playbackRate?: number;
  sources: Array<{ src: string; type: string }>;
  videoPreview?: boolean;
  documentId: string;
};

export function useAudio({ sources, playbackRate, videoPreview, documentId }: UseAudioOptions) {
  const [playing, setPlayingState] = useState(false);
  const [duration, setDuration] = useState<number | undefined>();
  const [buffering, setBuffering] = useState(false);
  const [playtimeState, setPlaytimeState] = useState(0);
  const lastPlaytimeRef = useRef<number>(0);

  const [playerElement, setPlayerElement] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    const newPlayerElement = video([]);
    setPlayerElement(newPlayerElement);

    const e = events(newPlayerElement);
    e.onDurationChange(() => {
      setDuration(props(newPlayerElement).duration);
    });
    e.onPlay(() => setPlayingState(true));
    e.onPause(() => setPlayingState(false));
    e.onBuffering(() => setBuffering(true));
    e.onReady(() => setBuffering(false));
    e.onPlaytimeUpdate((sec) => {
      if (sec != undefined && sec != 0) {
        setPlaytimeState(sec);
      }
    });

    setDuration(props(newPlayerElement).duration);

    return () => {
      newPlayerElement.pause();
      newPlayerElement.innerHTML = '';
      newPlayerElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!playerElement) return;
    if (!videoPreview) {
      playerElement.className = 'hidden';
      return;
    }

    playerElement.className = clsx(
      'fixed',
      'right-6',
      'bottom-24',
      'bg-black',
      'border-black dark:border-neutral-200',
      'border-2',
      'shadow-brutal',
      'shadow-slate-400 dark:shadow-neutral-600',
      'rounded-lg',
      'max-h-[calc(100vh-10rem)]',
      'max-w-[calc(100vw-3rem)]',
      'h-[200px]',
    );

    const videoBottomSpacer = document.getElementById('video-bottom-spacer');
    const localStorageHeight = window.localStorage.getItem(`video-size-${documentId}`);
    if (localStorageHeight) {
      playerElement.style.height = localStorageHeight;

      if (videoBottomSpacer) videoBottomSpacer.style.height = localStorageHeight;
    }

    const getCursorType = (e: MouseEvent) => {
      const videoRect = playerElement.getBoundingClientRect();
      const paddedRect = padRect(videoRect, 10);
      if (!rectContains(paddedRect, { x: e.clientX, y: e.clientY })) {
        return 'initial';
      }

      const isLeftEdge = Math.abs(e.clientX - videoRect.x) < 10;
      const isTopEdge = Math.abs(e.clientY - videoRect.y) < 10;
      if (isLeftEdge && isTopEdge) {
        return 'nw-resize';
      } else if (isLeftEdge) {
        return 'w-resize';
      } else if (isTopEdge) {
        return 'n-resize';
      } else {
        return 'initial';
      }
    };

    let draggingStart: null | {
      x: number;
      y: number;
      initialWidth: number;
      initialHeight: number;
      cursorType: 'nw-resize' | 'w-resize' | 'n-resize' | 'initial';
    } = null;
    const onPointerDown = (e: MouseEvent) => {
      const videoRect = playerElement.getBoundingClientRect();
      const cursorType = getCursorType(e);
      if (cursorType != 'initial') {
        draggingStart = {
          x: e.clientX,
          y: e.clientY,
          initialWidth: videoRect.width,
          initialHeight: videoRect.height,
          cursorType,
        };
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);

    const onPointerUp = () => {
      draggingStart = null;
    };
    document.addEventListener('pointerup', onPointerUp);

    const onPointerMove = (e: MouseEvent) => {
      if (draggingStart) {
        let isWidth = draggingStart.cursorType == 'w-resize';
        const targetAspect = draggingStart.initialWidth / draggingStart.initialHeight;
        const width = draggingStart.initialWidth + draggingStart.x - e.clientX;
        const height = draggingStart.initialHeight + draggingStart.y - e.clientY;
        if (draggingStart.cursorType === 'nw-resize') {
          const newAspect = width / height;
          isWidth = targetAspect > newAspect;
        }
        const setHeight = isWidth ? width / targetAspect : height;
        const maxHeight = (window.innerWidth - 50) / targetAspect;
        playerElement.style.height = `${Math.max(Math.min(setHeight, maxHeight), 50)}px`;
        if (videoBottomSpacer) videoBottomSpacer.style.height = playerElement.style.height;
        window.localStorage.setItem(`video-size-${documentId}`, playerElement.style.height);

        document.documentElement.style.cursor = draggingStart.cursorType;
      } else {
        document.documentElement.style.cursor = getCursorType(e);
      }
    };
    document.addEventListener('pointermove', onPointerMove);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointermove', onPointerMove);
    };
  }, [playerElement, videoPreview, documentId]);

  useEffect(() => {
    if (!playerElement) return;
    playerElement.innerHTML = '';

    sources.forEach((source) => {
      const sourceElement = document.createElement('source');
      sourceElement.src = source.src;
      sourceElement.type = source.type;
      playerElement.appendChild(sourceElement);
    });

    actions(playerElement).load();
    events(playerElement).onLoaded(() => {
      actions(playerElement).setPlaytime(lastPlaytimeRef.current);
    });

    if (playing) {
      actions(playerElement).play();
    } else {
      actions(playerElement).pause();
    }

    return () => {
      lastPlaytimeRef.current = props(playerElement).playtime || 0;
    };
  }, [playerElement, sources]);

  // faster playtime updates
  useEffect(() => {
    if (playing) {
      const interpolateInterval = window.setInterval(() => {
        if (!playerElement || !playerElement.currentTime) return;
        setPlaytimeState(playerElement.currentTime);
      }, 100);

      return () => {
        window.clearInterval(interpolateInterval);
      };
    }
  }, [playing]);

  useEffect(() => {
    if (!playerElement) return;

    if (playbackRate != undefined) {
      actions(playerElement).setRate(playbackRate);
    }
  }, [playerElement, sources, playbackRate]);

  const setPlaytime = useCallback(
    (sec: number) => {
      if (!playerElement) return;
      actions(playerElement).setPlaytime(sec);
      setPlaytimeState(sec);
    },
    [playerElement],
  );

  const seekRelative = useCallback(
    (sec: number) => {
      if (!playerElement) return;
      const currentPlaytime = props(playerElement).playtime;

      if (currentPlaytime != undefined) {
        actions(playerElement).setPlaytime(currentPlaytime + sec);
        setPlaytimeState(currentPlaytime + sec);
      }
    },
    [playerElement],
  );

  const play = useCallback(() => {
    if (!playerElement) return;
    actions(playerElement).play();
  }, [playerElement]);

  const pause = useCallback(() => {
    if (!playerElement) return;
    actions(playerElement).pause();
  }, [playerElement]);

  return {
    play,
    pause,
    setPlaytime,
    seekRelative,
    playtime: playtimeState,
    playing,
    duration,
    buffering,
  };
}

const MEDIA_PRIORITY = [
  'video/mp4', // more precise seeking in most browsers
  'audio/ogg',
  'audio/mpeg',
];

export function sortMediaFiles<T extends { type: string; tags: string[] }>(mediaFiles: T[]) {
  const sorted = [];

  const relevantMediaFiles = mediaFiles.filter((media) => !media.tags.includes('original'));
  const originalMediaFiles = mediaFiles.filter((media) => media.tags.includes('original'));

  for (const contentType of MEDIA_PRIORITY) {
    const files = relevantMediaFiles.filter((file) => file.type == contentType);
    sorted.push(...files);
  }

  const rest = relevantMediaFiles.filter((file) => !MEDIA_PRIORITY.includes(file.type));
  sorted.push(...rest);

  sorted.push(...originalMediaFiles);

  return sorted;
}
