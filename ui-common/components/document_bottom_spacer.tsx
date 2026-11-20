import { useCallback, useEffect, useState } from 'react';
import { MediaPlayer } from '../utils/media_player';

/**
 * A spacer component maintaining the same height as the player bar, including the video preview and the alignment editor.
 */
export function DocumentBottomSpacer({ mediaPlayer }: { mediaPlayer: MediaPlayer }) {
  const calcSize = useCallback(
    () => mediaPlayer.videoBottomOffset + (mediaPlayer.videoVisible ? mediaPlayer.videoHeight : 0),
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
    mediaPlayer.addListener('videoBottomOffsetChange', updateSize);

    return () => {
      mediaPlayer.removeListener('videoHeightChange', updateSize);
      mediaPlayer.removeListener('showVideo', updateSize);
      mediaPlayer.removeListener('hideVideo', updateSize);
      mediaPlayer.removeListener('videoBottomOffsetChange', updateSize);
    };
  }, [calcSize, mediaPlayer]);

  return <div style={{ height: height + 'px' }} />;
}
