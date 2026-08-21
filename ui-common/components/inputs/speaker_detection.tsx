import { clsx } from 'clsx';
import { FormControl, Input } from '../form';
import { HelpPopup } from '../popup';

type RadioElementProps<T extends string> = {
  value: T;
  selected: string;
  label: string;
  onChange: (value: T) => void;
};

function RadioElement<T extends string>({
  value,
  label,
  selected,
  onChange,
}: RadioElementProps<T>) {
  const checked = selected === value;
  const id = `radio-${value}`;

  return (
    <>
      <input
        type="radio"
        id={id}
        value={value}
        className="hidden"
        checked={checked}
        onChange={(e) => {
          if (e.currentTarget.checked) {
            onChange(value);
          }
        }}
      />
      <label
        htmlFor={id}
        className={clsx(
          'block py-2 text-center flex-grow basis-1',
          'border-black dark:border-white border-2',
          'first-of-type:rounded-l first-of-type:border-r-0 last-of-type:rounded-r last-of-type:border-l-0',
          (checked && 'bg-gray-300 dark:bg-gray-700') || 'bg-transparent',
        )}
      >
        {label}
      </label>
    </>
  );
}

export type SpeakerDetectionInputProps = {
  value: 'off' | 'on' | 'advanced';
  onChange: (value: SpeakerDetectionInputProps['value']) => void;
  numberOfSpeakers: number;
  onNumberOfSpeakersChange: (value: number) => void;
};

export function SpeakerDetectionInput({
  value,
  onChange,
  numberOfSpeakers,
  onNumberOfSpeakersChange,
}: SpeakerDetectionInputProps) {
  return (
    <>
      <FormControl label="Speaker Detection">
        <HelpPopup>
          <p className="pb-2">
            If multiple persons speek in your recording, transcribee can try to annotate your text
            with speaker information. Leaving this setting on &quot;On&quot; will result in
            transcribee trying to guess how many people are speaking in the recording and detect
            them.
          </p>
          <p className="pb-2">
            If you know how many people speek in your recording, you can set this control to
            advanced and manually enter the number of speakers. If only one person is speeking (or
            if you dont need speaker information) you can turn the speaker detection off.
          </p>
        </HelpPopup>
        <div className="flex">
          <RadioElement label="Off" value="off" selected={value} onChange={onChange} />
          <RadioElement label="On" value="on" selected={value} onChange={onChange} />
          <RadioElement label="Advanced" value="advanced" selected={value} onChange={onChange} />
        </div>
      </FormControl>
      {value == 'advanced' && (
        <FormControl label="Number of Speakers" className="-mt-4">
          <Input
            type="number"
            min={2}
            value={numberOfSpeakers}
            onChange={(e) => {
              onNumberOfSpeakersChange(e.currentTarget.valueAsNumber);
            }}
          />
        </FormControl>
      )}
    </>
  );
}
