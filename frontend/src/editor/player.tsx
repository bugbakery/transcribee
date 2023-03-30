import clsx from 'clsx';
import { IconButton } from '../components/button';
import { ImPause, ImPlay2, ImForward3, ImBackward2 } from 'react-icons/im';
import { useCallback, useRef, useState } from 'react';
import { WaveSurfer, WaveForm } from 'wavesurfer-react';
import WaveSurferType from 'wavesurfer.js';

export function PlayerBar({ audioFile }: { audioFile: string | undefined }) {
  const [playing, setPlayingState] = useState(false);
  const waveSurferRef = useRef<WaveSurferType | undefined>();
  const setPlaying = (playing: boolean) => {
    if (waveSurferRef.current) {
      setPlayingState(playing);
      if (playing) {
        waveSurferRef.current.play();
      } else {
        waveSurferRef.current.pause();
      }
    }
  };
  const handleWSMount = useCallback(
    (ws: WaveSurferType | null) => {
      if (!ws) return;
      waveSurferRef.current = ws;

      if (ws && audioFile) {
        ws.load(audioFile);
        ws.setHeight(40);

        ws.on('ready', () => {
          console.debug('WaveSurfer is ready');
        });

        ws.on('loading', (data) => {
          console.debug('WaveSurfer Loading --> ', data);
        });
      }
    },
    [audioFile],
  );

  const PlayPause = playing ? ImPause : ImPlay2;

  if (!audioFile) return null;

  return (
    <>
      <div
        className={clsx(
          'fixed bottom-0',
          'w-full max-w-screen-xl height-8 my-2',
          'flex',
          'p-2',
          'bg-white',
          'border-black',
          'border-2',
          'shadow-brutal',
          'shadow-slate-400',
          'rounded-lg',
          'items-center',
        )}
      >
        <IconButton icon={ImBackward2} label="backwards" />
        <IconButton
          icon={PlayPause}
          label="play / pause"
          size={28}
          onClick={() => setPlaying(!playing)}
        />
        <IconButton icon={ImForward3} label="forwards" />

        <div className="pl-4 flex-grow">
          <WaveSurfer onMount={handleWSMount}>
            <WaveForm id="waveform" cursorColor="red"></WaveForm>
          </WaveSurfer>
        </div>
      </div>
      <div className="pb-20" />
    </>
  );
}
