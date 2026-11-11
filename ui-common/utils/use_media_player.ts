import { useCallback, useEffect, useState } from 'react';
import { MediaPlayer } from './media_player';

export function useMediaPlayerInfo(player: MediaPlayer) {
  const stateFromPlayer = useCallback((p: MediaPlayer) => {
    return {
      playing: p.isPlaying,
      scrubbing: p.isScrubbing,
      buffering: p.isBuffering,
      duration: p.duration,
      rate: p.playbackRate,
    };
  }, []);
  const [state, setState] = useState(stateFromPlayer(player));

  useEffect(() => {
    const updateState = () => {
      setState(stateFromPlayer(player));
    };
    player.addListener('durationChange', updateState);
    player.addListener('play', updateState);
    player.addListener('pause', updateState);
    player.addListener('buffering', updateState);
    player.addListener('ready', updateState);
    player.addListener('rate', updateState);

    return () => {
      player.removeListener('durationChange', updateState);
      player.removeListener('play', updateState);
      player.removeListener('pause', updateState);
      player.removeListener('buffering', updateState);
      player.removeListener('ready', updateState);
      player.removeListener('rate', updateState);
    };
  }, [player, stateFromPlayer]);

  return state;
}

export function useSmoothMediaPlayerPlaytime(player: MediaPlayer, throttle: number = 0) {
  const [playtime, setPlaytime] = useState(player.playtime || 0);
  useEffect(() =>{
    const cancelFlag = { set: false };

    const updatePlaytime = () => {
      const time = player.playtime;

      if (time !== undefined) {
        setPlaytime(time);
      }
    }

    const updateLoop = () => {
      if (cancelFlag.set) return;
      updatePlaytime();

      if (throttle) {
        setTimeout(() => {
          requestAnimationFrame(updateLoop);
        }, throttle);
      }
      else {
        requestAnimationFrame(updateLoop);
      }
    };

    updateLoop();

    player.addListener('playtime', updatePlaytime);

    return () => {
      player.removeListener('playtime', updatePlaytime);
      cancelFlag.set = true;
    }
  }, [player, throttle]);

  return playtime;
}

export function useMediaPlayer() {
  const [mediaPlayer, _] = useState(() => new MediaPlayer());

  useEffect(() => {
    mediaPlayer.init();

    return () => {
      mediaPlayer.deinit();
    };
  }, [mediaPlayer]);

  return mediaPlayer;
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
