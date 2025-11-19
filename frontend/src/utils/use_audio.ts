import { actions, video, events, props, audio } from '@podlove/html5-audio-driver';
import { useCallback, useEffect, useRef, useState } from 'react';

type UseAudioOptions = {
  playbackRate?: number;
  sources: Array<{ src: string; type: string }>;
  videoPreview?: boolean;
};

export function useAudio({ sources, playbackRate, videoPreview }: UseAudioOptions) {
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
    if (videoPreview) {
      playerElement.style = `
        position: fixed;
        bottom: 90px;
        right: 20px;
        height: 170px;
        width: 300px;
      `;
    } else {
      playerElement.style = `
        display: none;
      `;
    }
  }, [videoPreview]);

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
