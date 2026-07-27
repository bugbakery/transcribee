import clsx from 'clsx';
import { FormControl, Slider } from '../form';
import { HelpPopup } from '../popup';

// since large uses the faster turbo model, there is no reason to use the medium model
const modelRanking = ['tiny', 'base', 'small', 'large'] as const;

export type ModelSize = (typeof modelRanking)[number];

export type TranscriptionQualityInputProps = {
  value: ModelSize;
  onChange: (value: ModelSize) => void;
  error: string | undefined;
};

export function TranscriptionQualityInput({
  error,
  value,
  onChange,
}: TranscriptionQualityInputProps) {
  const lowQuality = modelRanking.indexOf(value) < 2;

  return (
    <FormControl
      label="Transcription Quality"
      error={error}
      className={clsx('p-3 -mb-2 -mx-3 rounded', lowQuality && 'bg-red-500 bg-opacity-10')}
    >
      <HelpPopup className="mr-3">
        <p className="pb-2">With this slider you can influence the quality of the transcription.</p>
        <p className="pb-2">
          Moving the slider to the right produces better transcripts at the cost of longer wait
          times. Moving it to the left produces worse transcripts but shortens the transcription
          time.
        </p>
        <p>The default position of the slider should be a good tradeoff for most uses.</p>
      </HelpPopup>
      <div className="relative mb-5">
        <Slider
          min={1}
          max={modelRanking.length}
          value={modelRanking.indexOf(value) + 1}
          onChange={(e) => {
            onChange(modelRanking[e.currentTarget.valueAsNumber - 1]);
          }}
        />
        <span
          className={clsx('text-sm text-gray-500 dark:text-gray-400 absolute start-0 -bottom-6')}
        >
          Fastest
        </span>
        <span className={clsx('text-sm text-gray-500 dark:text-gray-400 absolute end-0 -bottom-6')}>
          Best
        </span>
      </div>

      {lowQuality ? (
        <>
          <p className="py-2 pt-6 text-red-700 dark:text-red-400">
            It is not recommended to use a low quality setting for real work. The result will be
            very underwhelming.
          </p>
        </>
      ) : (
        <></>
      )}
    </FormControl>
  );
}
