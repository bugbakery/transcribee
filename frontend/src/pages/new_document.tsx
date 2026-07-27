import { useEffect, useMemo, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { useLocation } from 'wouter';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { createDocument, importDocument } from '../api/document';
import { Dialog, DialogTitle } from 'transcribee-ui-common/components/dialog';
import { FormControl, Input } from 'transcribee-ui-common/components/form';
import { LoadingSpinnerButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { SpeakerDetectionInput } from 'transcribee-ui-common/components/inputs/speaker_detection';
import {
  ModelLanguageInput,
  ModelLanguage,
} from 'transcribee-ui-common/components/inputs/model_language';
import {
  TranscriptionQualityInput,
  ModelSize,
} from 'transcribee-ui-common/components/inputs/transcription_quality';
import { AppContainer } from '../components/app_container';
import * as Automerge from '@automerge/automerge';
import { getDocumentWsUrl } from '../api/auth';
import { HelpPopup } from 'transcribee-ui-common/components/popup';
import { DropFilePicker } from 'transcribee-ui-common/components/drop_file_picker';
import { loadTranscribeeArchive } from '../components/transcribee_archive_reader';

type FieldValues = {
  name: string;
  audioFile: File | null;
  model: ModelSize;
  language: ModelLanguage;
  speakerDetection: 'off' | 'on' | 'advanced';
  numberOfSpeakers: number;
};

export function NewDocumentPage() {
  const [_, navigate] = useLocation();
  const [loading, setLoading] = useState(false);
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
      audioFile: null,
      name: '',
      speakerDetection: 'on',
      numberOfSpeakers: 2,
    },
  });

  const [errorMessage, setErrorMessage] = useState('');

  register('audioFile', {
    required: true,
  });

  const audioFile = watch('audioFile');
  const name = watch('name');

  useEffect(() => {
    if (audioFile && !name) {
      const fileName = audioFile.name;
      const parts = fileName.split('.');
      const niceFileName = parts.slice(0, -1).join(' ').replaceAll('_', ' ').replaceAll('-', ' ');
      setValue('name', niceFileName);
    }
  }, [audioFile]);

  // Switch to import mode if a .transcribee file is selected
  const isImport = useMemo(() => audioFile?.name.endsWith('.transcribee'), [audioFile]);

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    if (!data.audioFile) {
      console.error('[NewDocumentPage] Illegal state: audioFile is undefined.');
      return;
    }

    try {
      setLoading(true);
      let response;
      if (isImport) {
        const bytes = await audioFile!.bytes();
        const [automergeFile, mediaFile] = await loadTranscribeeArchive(bytes);
        if (!automergeFile) {
          setErrorMessage('Not a valid transcribee archive. Missing document.automerge');
          throw 'Not a valid transcribee archive. Missing document.automerge';
        }
        if (!mediaFile) {
          setErrorMessage('Not a valid transcribee archive. Missing media');
          throw 'Not a valid transcribee archive. Missing media';
        }

        type DocumentImportParameters = Parameters<typeof importDocument>[0];
        const doc = Automerge.load(new Uint8Array(await automergeFile.arrayBuffer()));
        const changes = Automerge.getChanges(Automerge.init(), doc);
        const documentParameters: DocumentImportParameters = {
          name: data.name,
          media_file: mediaFile,
        };

        response = await importDocument(documentParameters);
        const ws = new ReconnectingWebSocket(getDocumentWsUrl(response.data.id), []);
        for (const change of changes) {
          ws.send(change);
        }
      } else {
        type DocumentCreateParameters = Parameters<typeof createDocument>[0];

        const documentParameters: DocumentCreateParameters = {
          name: data.name,
          file: data.audioFile,
          model: data.model,
          language: data.language,
        };
        if (data.speakerDetection == 'off') {
          documentParameters.number_of_speakers = 0;
        } else if (data.speakerDetection == 'advanced') {
          documentParameters.number_of_speakers = data.numberOfSpeakers;
        }

        response = await createDocument(documentParameters);
      }

      if (response.ok) {
        navigate('/');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppContainer
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      className="items-center pt-[max(25px,calc(50vh-400px))]"
    >
      <Dialog className={'w-96'}>
        <DialogTitle>New Document</DialogTitle>
        <form onSubmit={handleSubmit(submitHandler)}>
          <div className="flex flex-col gap-7">
            <FormControl label="Name" error={errors.name && 'This field is required.'}>
              <HelpPopup>
                <p>This name will be used in the overview to identify the transcript.</p>
              </HelpPopup>
              <Input autoFocus {...register('name', { required: true })} />
            </FormControl>

            <div>
              <DropFilePicker
                accept="audio/*,video/*,.transcribee"
                value={audioFile}
                onFileChange={(file) => {
                  setValue('audioFile', file, {
                    shouldTouch: true,
                    shouldDirty: true,
                  });
                }}
                placeholder="Drag audio or transcribee file here"
              />
              {errors.audioFile && <p className="text-red-600 text-sm mt-0.5">File is required.</p>}
            </div>
            {isImport ? (
              <div className="block text-sm bg-gray-100 px-2 py-2 rounded text-center text-gray-700">
                You selected a transcribee archive file, which will be imported as a new document.
              </div>
            ) : (
              <>
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
              </>
            )}

            {errorMessage && (
              <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
                {errorMessage}
              </div>
            )}

            <div className="flex justify-between">
              <SecondaryButton type="button" onClick={() => navigate(`/`)}>
                Cancel
              </SecondaryButton>
              <LoadingSpinnerButton loading={loading} variant="primary" type="submit">
                {isImport ? 'Import' : 'Create'}
              </LoadingSpinnerButton>
            </div>
          </div>
        </form>
      </Dialog>
    </AppContainer>
  );
}
