import { useEffect, useRef } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { SpeakerDetectionInput } from 'transcribee-ui-common/components/inputs/speaker_detection';
import {
  ModelLanguageInput,
  ModelLanguage,
} from 'transcribee-ui-common/components/inputs/model_language';
import {
  ModelSize,
  TranscriptionQualityInput,
} from 'transcribee-ui-common/components/inputs/transcription_quality';
import { PrimaryButton } from 'transcribee-ui-common/components/button';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useResizeWindowToFitElement } from '../utils/window';

type FieldValues = {
  files: string[];
  model: ModelSize;
  language: ModelLanguage;
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
      model: 'large',
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

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    if (data.files.length == 0) {
      console.error('[NewDocumentPage] Illegal state: audioFile is undefined.');
      return;
    }

    await invoke('transcribe_files', {
      mediaFilePaths: data.files,
      model: data.model,
      language: data.language,
    });
    await getCurrentWindow().close();
  };

  return (
    <div className="px-8 py-8" ref={containerRef}>
      <form onSubmit={handleSubmit(submitHandler)}>
        <div className="flex flex-col gap-7">
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
          <TranscriptionQualityInput
            value={watch('model')}
            onChange={(value) => setValue('model', value)}
            error={errors.model?.message}
          />
          <ModelLanguageInput
            value={watch('language')}
            onChange={(value) => setValue('language', value)}
            error={errors.language?.message}
          />
          <SpeakerDetectionInput
            value={watch('speakerDetection')}
            onChange={(value) => setValue('speakerDetection', value)}
            numberOfSpeakers={watch('numberOfSpeakers')}
            onNumberOfSpeakersChange={(value) => setValue('numberOfSpeakers', value)}
          />

          <div className="flex justify-end">
            <PrimaryButton type="submit">Create</PrimaryButton>
          </div>
        </div>
      </form>
    </div>
  );
}
