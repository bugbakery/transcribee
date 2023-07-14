import { actions, audio, events, props } from '@podlove/html5-audio-driver';
import { useCallback, useEffect, useState } from 'react';

type UseAudioOptions = {
  playbackRate?: number;
  sources: Array<{ src: string; type: string }>;
};

export function useAudio({ sources, playbackRate }: UseAudioOptions) {
  const [playing, setPlayingState] = useState(false);
  const [duration, setDuration] = useState<number | undefined>();
  const [buffering, setBuffering] = useState(false);
  const [playtimeState, setPlaytimeState] = useState(0);

  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const myAudioElement = audio(sources);
    setAudioElement(myAudioElement);
    actions(myAudioElement).load(); // in case element is reused

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
      myAudioElement.innerHTML = ''; // cleanup media element for next use
      myAudioElement.remove();
    };
  }, [sources]);

  useEffect(() => {
    if (audioElement) {
      const e = events(audioElement);
      e.onDurationChange(() => {
        if (!audioElement) return;
        setDuration(props(audioElement).duration);
      });
      e.onPlay(() => setPlayingState(true));
      e.onPause(() => setPlayingState(false));
      e.onBuffering(() => setBuffering(true));
      e.onReady(() => setBuffering(false));
      e.onPlaytimeUpdate((sec) => {
        if (!audioElement) return;

        if (sec != undefined) {
          setPlaytimeState(sec);
        }
      });

      setDuration(props(audioElement).duration);
      actions(audioElement).setPlaytime(0);
    }
  }, [audioElement]);

  useEffect(() => {
    if (!audioElement) return;

    if (playbackRate != undefined) {
      actions(audioElement).setRate(playbackRate);
    }
  }, [audioElement, playbackRate]);

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
