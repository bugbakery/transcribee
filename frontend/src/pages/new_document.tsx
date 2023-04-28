import { useRef, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import clsx from 'clsx';
import { useLocation } from 'wouter';

import { createDocument } from '../api/document';
import { Dialog, DialogTitle } from '../components/dialog';
import { FormControl, Input } from '../components/form';
import { PrimaryButton, SecondaryButton } from '../components/button';
import { AppCenter } from '../components/app';

type FieldValues = {
  name: string;
  audioFile: FileList | undefined;
};

export function NewDocumentPage() {
  const [_, navigate] = useLocation();
  const [dropIndicator, setDropIndicator] = useState(false);
  const audioFileRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<FieldValues>();

  const { ref: audioFileRegisterRef, ...audioFileRegister } = register('audioFile', {
    required: true,
  });

  const audioFile = watch('audioFile');

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    if (!data.audioFile) {
      console.error('[NewDocumentPage] Illegal state: audioFile is undefined.');
      return;
    }

    const response = await createDocument({ name: data.name, file: data.audioFile[0] });

    if (response.ok) {
      navigate('/');
    }
  };

  return (
    <AppCenter onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
      <Dialog>
        <DialogTitle>New Document</DialogTitle>
        <form onSubmit={handleSubmit(submitHandler)}>
          <div className="flex flex-col gap-6">
            <FormControl label="Name" error={errors.name && 'This field is required.'}>
              <Input autoFocus {...register('name', { required: true })} />
            </FormControl>

            <div>
              <div
                className={clsx(
                  'border-2',
                  'border-b-0',
                  'border-black',
                  'rounded-t',
                  'h-32',
                  'flex',
                  'items-center',
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

                  if (!fileType.startsWith('audio/') && !fileType.startsWith('video/')) {
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
                    'top-1',
                    'bottom-1',
                    'right-1',
                    'left-1',
                    'border-2',
                    'rounded',
                    'border-black',
                    'border-dashed',
                    'flex',
                    'items-center',
                    'justify-center',
                    dropIndicator || 'hidden',
                  )}
                >
                  <div className="text-center">
                    <p className="font-medium">Drop audio file…</p>
                  </div>
                </div>
                <div className={clsx('text-center', dropIndicator && 'hidden')}>
                  <p className="font-medium">Drag audio file here</p>
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
                      accept="audio/*,video/*"
                    />
                    <a
                      href="#"
                      className={clsx(
                        'inline-block',
                        'relative',
                        'link',
                        'underline',
                        'rounded-sm',
                        'pointer-events-none',
                        'hover:opacity-60',
                        'peer-hover:opacity-60',
                        'peer-focus-visible:outline',
                        'peer-focus-visible:outline-3',
                        'peer-focus-visible:outline-blue-600',
                      )}
                    >
                      choose file
                    </a>
                  </p>
                </div>
              </div>
              <div
                className={clsx(
                  'bg-black',
                  'text-white',
                  'text-sm',
                  'text-center',
                  'p-2',
                  'whitespace-nowrap',
                  'overflow-hidden',
                  'text-ellipsis',
                  'rounded-b',
                )}
              >
                {audioFile?.[0]?.name || 'No file selected.'}
              </div>
              {errors.audioFile && (
                <p className="text-red-600 text-sm mt-0.5">Audio file is required.</p>
              )}
            </div>
            <div className="flex justify-between">
              <SecondaryButton onClick={() => navigate(`/`)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit">Create</PrimaryButton>
            </div>
          </div>
        </form>
      </Dialog>
    </AppCenter>
  );
}
