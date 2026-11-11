import { useCallback, useEffect, useState } from 'react';
import { MediaPlayer } from '../utils/media_player';

/**
 * A spacer component maintaining the same height as the video preview from the given MediaPlayer.
 * When preview is hidden it's height is zero.
 */
export function VideoSpacer({ mediaPlayer }: { mediaPlayer: MediaPlayer }) {
  const calcSize = useCallback(
    () => (mediaPlayer.videoVisible ? mediaPlayer.videoHeight : 0),
    [mediaPlayer],
  );
  const [height, setHeight] = useState(calcSize());

  useEffect(() => {
    const updateSize = () => {
      setHeight(calcSize());
    };
    mediaPlayer.addListener('videoHeightChange', updateSize);
    mediaPlayer.addListener('showVideo', updateSize);
    mediaPlayer.addListener('hideVideo', updateSize);

    return () => {
      mediaPlayer.removeListener('videoHeightChange', updateSize);
      mediaPlayer.removeListener('showVideo', updateSize);
      mediaPlayer.removeListener('hideVideo', updateSize);
    };
  }, [calcSize, mediaPlayer]);

  return <div style={{ height: height + 'px' }} />;
}
