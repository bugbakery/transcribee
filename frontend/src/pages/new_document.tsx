import { useEffect, useMemo, useRef, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import clsx from 'clsx';
import { useLocation } from 'wouter';
import languageNames from './languageNames.json';

import ReconnectingWebSocket from 'reconnecting-websocket';
import { createDocument, importDocument } from '../api/document';
import { Dialog, DialogTitle } from '../components/dialog';
import { FormControl, Input, Select, Slider } from '../components/form';
import { LoadingSpinnerButton, SecondaryButton } from '../components/button';
import { AppContainer } from '../components/app';
import { useGetConfig } from '../api/config';
import { BlobReader, BlobWriter, ZipReader, Entry } from '@zip.js/zip.js';
import * as Automerge from '@automerge/automerge';
import { getDocumentWsUrl } from '../utils/auth';
import { RequestDataType } from '../api';
import { HelpPopup } from '../components/popup';

type FieldValues = {
  name: string;
  audioFile: FileList | undefined;
  quality: number;
  language: string;
  speakerDetection: 'off' | 'on' | 'advanced';
  numberOfSpeakers: number;
};

type ModelConfig = RequestDataType<typeof useGetConfig>['models'];

export function getLanguages(models: ModelConfig): string[] {
  return models['base']?.languages;
}

async function getEntry(
  reader: ZipReader<BlobReader>,
  entries: Entry[],
  name: string,
): Promise<Blob | null> {
  for (const entry of entries) {
    if (entry.filename == name) {
      const writer = new BlobWriter();
      const data = entry.getData ? await entry.getData(writer) : null;
      return data;
    }
  }
  return null;
}

export function NewDocumentPage() {
  const [_, navigate] = useLocation();
  const [dropIndicator, setDropIndicator] = useState(false);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: config } = useGetConfig({});
  const models = config !== undefined ? config.models : {};
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
      audioFile: undefined,
      name: '',
      speakerDetection: 'on',
      numberOfSpeakers: 2,
    },
  });

  const [errorMessage, setErrorMessage] = useState('');

  const { ref: audioFileRegisterRef, ...audioFileRegister } = register('audioFile', {
    required: true,
  });

  const audioFile = watch('audioFile');
  const speakerDetection = watch('speakerDetection');
  const quality = watch('quality');
  const name = watch('name');

  useEffect(() => {
    if (audioFile?.[0] && !name) {
      const fileName = audioFile?.[0].name;
      const parts = fileName.split('.');
      const niceFileName = parts.slice(0, -1).join(' ').replaceAll('_', ' ').replaceAll('-', ' ');
      setValue('name', niceFileName);
    }
  }, [audioFile]);

  // Switch to import mode if a .transcribee file is selected
  const isImport = useMemo(() => audioFile?.[0]?.name.endsWith('.transcribee'), [audioFile]);

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    if (!data.audioFile) {
      console.error('[NewDocumentPage] Illegal state: audioFile is undefined.');
      return;
    }

    try {
      setLoading(true);
      let response;
      if (isImport) {
        type DocumentImportParameters = Parameters<typeof importDocument>[0];
        const zipReader = new ZipReader(new BlobReader(data.audioFile[0]));
        const entries = await zipReader.getEntries();
        const [automergeFile, mediaFile] = await Promise.all([
          getEntry(zipReader, entries, 'document.automerge'),
          getEntry(zipReader, entries, 'media'),
        ]);
        if (automergeFile === null) {
          setErrorMessage('Not a valid transcribee archive. Missing document.automerge');
          throw 'Not a valid transcribee archive. Missing document.automerge';
        }
        if (mediaFile === null) {
          setErrorMessage('Not a valid transcribee archive. Missing media');
          throw 'Not a valid transcribee archive. Missing media';
        }
        const doc = Automerge.load(new Uint8Array(await automergeFile.arrayBuffer()));
        const changes = Automerge.getChanges(Automerge.init(), doc).map((x) => new Blob([x]));
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

        const modelRanking = ['tiny', 'base', 'small', 'medium', 'large'];
        let model = modelRanking[data.quality - 1];
        if (`${model}.${data.language}` in models) {
          model = `${model}.${data.language}`;
        }

        const documentParameters: DocumentCreateParameters = {
          name: data.name,
          file: data.audioFile[0],
          model,
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
          <div className="flex flex-col gap-6">
            <FormControl label="Name" error={errors.name && 'This field is required.'}>
              <HelpPopup>
                <p>This name will be used in the overview to identify the transcript.</p>
              </HelpPopup>
              <Input autoFocus {...register('name', { required: true })} />
            </FormControl>

            <div>
              <div
                className={clsx(
                  'border-2',
                  'border-b-0',
                  'border-black dark:border-neutral-200',
                  'rounded-t',
                  'h-28',
                  'flex',
                  'justify-center',
                  'relative',
                )}
                onDragEnter={() => setDropIndicator(true)}
                onDragExit={() => setDropIndicator(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropIndicator(false);

                  const fileType = e.dataTransfer.files[0].type;
                  const fileName = e.dataTransfer.files[0].name;

                  if (
                    !fileType.startsWith('audio/') &&
                    !fileType.startsWith('video/') &&
                    !fileName.endsWith('.transcribee')
                  ) {
                    return;
                  }

                  setValue('audioFile', e.dataTransfer.files, {
                    shouldTouch: true,
                    shouldDirty: true,
                  });

                  if (audioFileRef.current) {
                    // also set files via ref since react-hook-form's setValue does not set the value properly
                    audioFileRef.current.files = e.dataTransfer.files;
                  }
                }}
              >
                <div
                  className={clsx(
                    'absolute',
                    'top-2 text-center',
                    'bottom-1',
                    'right-1',
                    'left-1',
                    'border-2',
                    'rounded',
                    'border-black dark:border-neutral-200',
                    'border-dashed',
                    'flex',
                    'items-center',
                    'justify-center',
                    dropIndicator || 'hidden',
                  )}
                >
                  <div className="text-center">
                    <p className="font-medium">Drop audio or transcribee file…</p>
                  </div>
                </div>
                <div
                  className={clsx(
                    'text-center max-w-full flex flex-col h-full justify-center',
                    dropIndicator && 'hidden',
                  )}
                >
                  {audioFile?.[0] && (
                    <>
                      <p className="mx-4 mt-4 text-sm text-neutral-400 font-medium">
                        Selected file
                      </p>
                      <div className="mx-4 flex-grow flex items-center mb-2">
                        <p className="max-w-full break-words">{audioFile?.[0].name}</p>
                      </div>
                    </>
                  )}
                  {!audioFile?.[0] && (
                    <>
                      <p className="font-medium">Drag audio or transcribee file here</p>
                      <p className="relative">
                        or{' '}
                        <input
                          {...audioFileRegister}
                          ref={(ref) => {
                            audioFileRegisterRef(ref);
                            audioFileRef.current = ref;
                          }}
                          type="file"
                          className="opacity-0 absolute peer w-full"
                          accept="audio/*,video/*,.transcribee"
                        />
                        <span
                          className={clsx(
                            'relative',
                            'underline',
                            'pointer-events-none',
                            'peer-hover:opacity-60',
                            'peer-focus-visible:outline',
                            'peer-focus-visible:outline-3',
                            'peer-focus-visible:outline-blue-600',
                          )}
                        >
                          choose file
                        </span>
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div
                className={clsx(
                  'bg-black dark:bg-neutral-200',
                  'text-white dark:text-black',
                  'text-sm',
                  'text-center',
                  'p-2',
                  'whitespace-nowrap',
                  'overflow-hidden',
                  'text-ellipsis',
                  'rounded-b',
                )}
              >
                {(audioFile?.[0] && (
                  <button
                    type="button"
                    onClick={() => {
                      setValue('audioFile', undefined);
                      if (audioFileRef.current) {
                        audioFileRef.current.value = '';
                      }
                    }}
                    className="underline hover:opacity-60"
                  >
                    Remove selection
                  </button>
                )) ||
                  'No file selected.'}
              </div>
              {errors.audioFile && <p className="text-red-600 text-sm mt-0.5">File is required.</p>}
            </div>
            {isImport ? (
              <div className="block text-sm bg-gray-100 px-2 py-2 rounded text-center text-gray-700">
                You selected a transcribee archive file, which will be imported as a new document.
              </div>
            ) : (
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
                      Moving the slider to the right produces better transcripts at the cost of
                      longer wait times. Moving it to the left produces worse transcripts but
                      shortens the transcription time.
                    </p>
                    <p>
                      The default position of the slider should be a good tradeoff for most uses.
                    </p>
                  </HelpPopup>
                  <div className="relative mb-6">
                    <Slider min={1} max={5} {...register('quality')} />
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
                      If you know the language of your document (and if only one language is
                      spoken), you can set it here explicitly. Doing so might result in slightly
                      better & faster transcriptions.
                    </p>
                    <p className="pb-2">
                      It is also fine to leave this control on &lsquo;Auto Detect&rsquo;.
                    </p>
                  </HelpPopup>
                  <div>
                    <Select {...register('language')}>
                      {getLanguages(models)?.map((lang) => (
                        <option value={lang} key={lang}>
                          {languageNames[lang as keyof typeof languageNames]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </FormControl>

                <FormControl label={'Speaker Detection'}>
                  <HelpPopup>
                    <p className="pb-2">
                      If multiple persons speek in your recording, transcribee can try to annotate
                      your text with speaker information. Leaving this setting on &quot;On&quot;
                      will result in transcribee trying to guess how many people are speaking in the
                      recording and detect them.
                    </p>
                    <p className="pb-2">
                      If you know how many people speek in your recording, you can set this control
                      to advanced and manually enter the number of speakers. If only one person is
                      speeking (or if you dont need speaker information) you can turn the speaker
                      detection off.
                    </p>
                  </HelpPopup>
                  <div className="flex">
                    <input
                      type="radio"
                      id="off"
                      value={'off'}
                      className="hidden peer/off"
                      {...register('speakerDetection')}
                    />
                    <label
                      htmlFor="off"
                      className={clsx(
                        'block bg-transparent py-2 text-center flex-grow basis-1',
                        'peer-checked/off:bg-gray-300 dark:peer-checked/off:bg-gray-700',
                        'border-black dark:border-white border-2 rounded-l',
                      )}
                    >
                      Off
                    </label>

                    <input
                      type="radio"
                      id="on"
                      value={'on'}
                      className="hidden peer/on"
                      {...register('speakerDetection')}
                    />
                    <label
                      htmlFor="on"
                      className={clsx(
                        'block bg-transparent  py-2 text-center flex-grow basis-1',
                        'peer-checked/on:bg-gray-300 dark:peer-checked/on:bg-gray-700',
                        'border-black dark:border-white border-y-2',
                      )}
                    >
                      On
                    </label>

                    <input
                      type="radio"
                      id="advanced"
                      value={'advanced'}
                      className="hidden peer/advanced"
                      {...register('speakerDetection')}
                    />
                    <label
                      htmlFor="advanced"
                      className={clsx(
                        'block bg-transparent py-2 text-center flex-grow basis-1',
                        'peer-checked/advanced:bg-gray-300 dark:peer-checked/advanced:bg-gray-700',
                        'border-black dark:border-white border-2 rounded-r',
                      )}
                    >
                      Advanced
                    </label>
                  </div>
                </FormControl>
                {speakerDetection == 'advanced' && (
                  <FormControl label="Number of Speakers" className="-mt-4">
                    <Input type="number" min={2} {...register('numberOfSpeakers')} />
                  </FormControl>
                )}
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
