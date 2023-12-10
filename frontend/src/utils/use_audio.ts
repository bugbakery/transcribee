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

  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const myAudioElement = videoPreview ? video([]) : audio([]);
    setAudioElement(myAudioElement);

    if (videoPreview) {
      myAudioElement.style = `
        position: fixed;
        bottom: 90px;
        right: 20px;
        height: 170px;
        width: 300px;
      `;
    } else {
      myAudioElement.style = `
        display: none;
      `;
    }

    const e = events(myAudioElement);
    e.onDurationChange(() => {
      setDuration(props(myAudioElement).duration);
    });
    e.onPlay(() => setPlayingState(true));
    e.onPause(() => setPlayingState(false));
    e.onBuffering(() => setBuffering(true));
    e.onReady(() => setBuffering(false));
    e.onPlaytimeUpdate((sec) => {
      if (sec != undefined) {
        setPlaytimeState(sec);
      }
    });

    setDuration(props(myAudioElement).duration);

    return () => {
      myAudioElement.pause();
      myAudioElement.innerHTML = '';
      myAudioElement.remove();
    };
  }, [videoPreview]);

  useEffect(() => {
    if (!audioElement) return;

    audioElement.innerHTML = '';

    sources.forEach((source) => {
      const sourceElement = document.createElement('source');
      sourceElement.src = source.src;
      sourceElement.type = source.type;
      audioElement.appendChild(sourceElement);
    });

    actions(audioElement).load();

    events(audioElement).onLoaded(() => {
      actions(audioElement).setPlaytime(lastPlaytimeRef.current);
    });

    if (playing) {
      actions(audioElement).play();
    } else {
      actions(audioElement).pause();
    }

    return () => {
      lastPlaytimeRef.current = props(audioElement).playtime || 0;
    };
  }, [audioElement, sources]);

  // faster playtime updates
  useEffect(() => {
    if (playing) {
      const interpolateInterval = window.setInterval(() => {
        if (!audioElement) return;
        setPlaytimeState(audioElement.currentTime);
      }, 100);

      return () => {
        window.clearInterval(interpolateInterval);
      };
    }
  }, [playing]);

  useEffect(() => {
    if (!audioElement) return;

    if (playbackRate != undefined) {
      actions(audioElement).setRate(playbackRate);
    }
  }, [audioElement, sources, playbackRate]);

  const setPlaytime = useCallback(
    (sec: number) => {
      if (!audioElement) return;
      actions(audioElement).setPlaytime(sec);
      setPlaytimeState(sec);
    },
    [audioElement],
  );

  const seekRelative = useCallback(
    (sec: number) => {
      if (!audioElement) return;
      const currentPlaytime = props(audioElement).playtime;

      if (currentPlaytime != undefined) {
        actions(audioElement).setPlaytime(currentPlaytime + sec);
        setPlaytimeState(currentPlaytime + sec);
      }
    },
    [audioElement],
  );

  const play = useCallback(() => {
    if (!audioElement) return;
    actions(audioElement).play();
  }, [audioElement]);

  const pause = useCallback(() => {
    if (!audioElement) return;
    actions(audioElement).pause();
  }, [audioElement]);

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
