import { useEffect, useRef } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { clsx } from 'clsx';
import languages from './languages.json';
import { FormControl, Select, Slider } from 'transcribee-ui-common/components/form';
import { SpeakerDetectionInput } from 'transcribee-ui-common/components/inputs/speaker_detection';
import { PrimaryButton } from 'transcribee-ui-common/components/button';
import { HelpPopup } from 'transcribee-ui-common/components/popup';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useResizeWindowToFitElement } from '../utils/window';

type FieldValues = {
  files: string[];
  quality: number;
  language: string;
  speakerDetection: 'off' | 'on' | 'advanced';
  numberOfSpeakers: number;
};

export function NewTranscriptDialog() {
  useEffect(() => {
    document.title = 'New Transcript';
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  useResizeWindowToFitElement(containerRef);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<FieldValues>({
    values: {
      quality: 4,
      language: 'auto',
      files: [],
      speakerDetection: 'on',
      numberOfSpeakers: 2,
    },
  });

  register('files', {
    required: true,
  });

  const files = watch('files');
  const speakerDetection = watch('speakerDetection');
  const quality = watch('quality');

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    if (data.files.length == 0) {
      console.error('[NewDocumentPage] Illegal state: audioFile is undefined.');
      return;
    }

    const modelRanking = ['tiny', 'base', 'small', 'large'] as const;
    const model = modelRanking[data.quality - 1];

    await invoke('transcribe_files', {
      mediaFilePaths: data.files,
      model,
      language: data.language,
    });
    await getCurrentWindow().close();
  };

  return (
    <div className="px-8 py-8" ref={containerRef}>
      <form onSubmit={handleSubmit(submitHandler)}>
        <div className="flex flex-col gap-6">
          <div>
            <PrimaryButton
              onClick={async () => {
                const selectedFiles = await open({
                  multiple: true,
                  directory: false,
                  filters: [
                    { name: 'Audio Files', extensions: ['mp3', 'acc', 'm4a', 'ogg', 'wav'] },
                    {
                      name: 'Video Files',
                      extensions: ['mkv', 'mp4', 'mov', 'avi', 'wmv', 'flv', 'webm'],
                    },
                  ],
                });

                if (selectedFiles) {
                  setValue('files', selectedFiles);
                }
              }}
              type="button"
              className="w-full"
            >
              Choose Media File(s)
            </PrimaryButton>
            <div className="text-center pt-1 text-sm">
              {files.length} File{files.length > 1 ? 's' : ''} selected
            </div>
            {errors.files && (
              <p className="text-center text-red-600 text-sm mt-2">You have to select a file.</p>
            )}
          </div>
          <>
            <FormControl
              label="Transcription Quality"
              error={errors.quality?.message}
              className={clsx('p-3 -mx-3 rounded', quality < 3 && 'bg-red-500 bg-opacity-10')}
            >
              <HelpPopup className="mr-3">
                <p className="pb-2">
                  With this slider you can influence the quality of the transcription.
                </p>
                <p className="pb-2">
                  Moving the slider to the right produces better transcripts at the cost of longer
                  wait times. Moving it to the left produces worse transcripts but shortens the
                  transcription time.
                </p>
                <p>The default position of the slider should be a good tradeoff for most uses.</p>
              </HelpPopup>
              <div className="relative mb-6">
                <Slider min={1} max={4} {...register('quality')} />
                <span
                  className={clsx(
                    'text-sm text-gray-500 dark:text-gray-400 absolute start-0 -bottom-6',
                  )}
                >
                  Fastest
                </span>
                <span
                  className={clsx(
                    'text-sm text-gray-500 dark:text-gray-400 absolute end-0 -bottom-6',
                  )}
                >
                  Best
                </span>
              </div>

              {quality < 3 ? (
                <>
                  <p className="py-2 text-red-700 dark:text-red-400">
                    It is not recommended to use a low quality setting for real work. The result
                    will be very underwhelming.
                  </p>
                </>
              ) : (
                <></>
              )}
            </FormControl>

            <FormControl label="Language" error={errors.language?.message}>
              <HelpPopup>
                <p className="pb-2">
                  If you know the language of your document (and if only one language is spoken),
                  you can set it here explicitly. Doing so might result in slightly better & faster
                  transcriptions.
                </p>
                <p className="pb-2">
                  It is also fine to leave this control on &lsquo;Auto Detect&rsquo;.
                </p>
              </HelpPopup>
              <div>
                <Select {...register('language')}>
                  {Object.entries(languages).map(([lang, name]) => (
                    <option value={lang} key={lang}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            </FormControl>

            <SpeakerDetectionInput
              value={speakerDetection}
              onChange={(value) => setValue('speakerDetection', value)}
              numberOfSpeakers={watch('numberOfSpeakers')}
              onNumberOfSpeakersChange={(value) => setValue('numberOfSpeakers', value)}
            />
          </>
          <div className="flex justify-end">
            <PrimaryButton type="submit">Create</PrimaryButton>
          </div>
        </div>
      </form>
    </div>
  );
}
