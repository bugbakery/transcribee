import clsx from 'clsx';
import { IconButton } from '../components/button';
import { ImPause, ImPlay2, ImForward3, ImBackward2 } from 'react-icons/im';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WaveSurfer, WaveForm } from 'wavesurfer-react';
import WaveSurferType from 'wavesurfer.js';
import { useGetDocument } from '../api/document';
import { Descendant } from 'slate';
import { CssRule } from '../utils/cssdom';
import { useOnTextClick } from './types';

export function PlayerBar({
  documentId,
  documentContent,
}: {
  documentId: string;
  documentContent: Descendant[];
}) {
  const { data } = useGetDocument({ document_id: documentId });
  const audioFile = data?.media_files[0]?.url;

  // state for knowing which symbol we should display at the play / pause button
  const [playing, setPlayingState] = useState(false);

  // handle the waveSurfer mounting
  const waveSurferRef = useRef<WaveSurferType | undefined>();
  const handleWSMount = useCallback(
    (ws: WaveSurferType | null) => {
      if (!ws) return;
      waveSurferRef.current = ws;

      if (ws && audioFile) {
        ws.load(audioFile);
        ws.setHeight(40);

        ws.on('play', () => setPlayingState(true));
        ws.on('pause', () => setPlayingState(false));
      }
    },
    [audioFile],
  );

  // calculate the start of the current element to color it
  const [currentElementStartTime, setCurrentElementStartTime] = useState(0.0);
  useEffect(() => {
    const progressCallback = () => {
      const time = waveSurferRef.current?.getCurrentTime() || 0;
      let startTimeOfElement = 0;

      // we loop from the back to the front to get the first element that is no longer too far
      // (if no text is at the current time, we highlight the text before)
      outer: for (let i = documentContent.length - 1; i >= 0; i--) {
        const paragraph = documentContent[i];
        if ('children' in paragraph) {
          for (let j = paragraph.children.length - 1; j >= 0; j--) {
            const word = paragraph.children[j];
            if (word.start && word.start / 1000 <= time) {
              startTimeOfElement = word.start;
              break outer;
            }
          }
        }
      }

      setCurrentElementStartTime(startTimeOfElement);
    };

    waveSurferRef.current?.on('seek', progressCallback);
    waveSurferRef.current?.on('audioprocess', progressCallback);
    return () => {
      waveSurferRef.current?.un('seek', progressCallback);
      waveSurferRef.current?.un('audioprocess', progressCallback);
    };
  }, [waveSurferRef.current, documentContent]);

  // skip to a timestamp if the user clicks on a word in the transcript. The corresponding event is
  // dispatched in transcription_editor.tsx
  useOnTextClick((text) => {
    if (text.start) {
      waveSurferRef.current?.seekTo(text.start / 1000 / waveSurferRef.current.getDuration());
    }
  });

  // if we don't know the path of the audio file yet, we can't start to render
  if (!audioFile) return <></>;

  return (
    <>
      {/* inject rules to highlight the current word  */}
      <CssRule
        css={`
          .${startTimeToClassName(currentElementStartTime)} {
            background: lightgreen;
            border-radius: 3px;
          }
        `}
      />

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
          icon={playing ? ImPause : ImPlay2}
          label="play / pause"
          size={28}
          onClick={() => {
            if (waveSurferRef.current) {
              if (!playing) {
                waveSurferRef.current.play();
              } else {
                waveSurferRef.current.pause();
              }
            }
          }}
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

export function startTimeToClassName(startTime: number) {
  return `start-${startTime.toFixed(3).replace('.', '')}`;
}
