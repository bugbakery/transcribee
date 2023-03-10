import { useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import clsx from 'clsx';
import { navigate } from 'wouter/use-location';

import { fetchApi } from '../api';
import Dialog from '../components/Dialog';
import DialogTitle from '../components/DialogTitle';
import Input from '../components/Input';
import PrimaryButton from '../components/PrimaryButton';
import FormControl from '../components/FormControl';

type FieldValues = {
  name: string;
  audioFile: FileList;
};

export default function NewDocumentPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>();

  const [dropIndicator, setDropIndicator] = useState(false);

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('audio_file', data.audioFile[0]);

    const response = await fetchApi('v1/documents/', {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      navigate('/');
    }
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <Dialog>
        <DialogTitle>New Document</DialogTitle>
        <form onSubmit={handleSubmit(submitHandler)}>
          <div className="flex flex-col gap-6">
            <FormControl label="Name" error={errors.name && 'This field is required.'}>
              <Input {...register('name', { required: true })} />
            </FormControl>

            <div>
              <div
                className={
                  'border-2 border-black rounded h-32 flex items-center justify-center relative'
                }
                onDragEnter={() => setDropIndicator(true)}
                onDragExit={() => setDropIndicator(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropIndicator(false);
                }}
              >
                {dropIndicator ? (
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
                    )}
                  >
                    <div className="text-center">
                      <p className="font-medium">Drop audio file…</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-medium">Drag audio file here</p>
                    <p className="relative">
                      or{' '}
                      <input
                        {...register('audioFile', { required: true })}
                        type="file"
                        className="opacity-0 absolute peer w-full"
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
                )}
              </div>
              {errors.audioFile && (
                <p className="text-red-600 text-sm mt-0.5">Audio file is required.</p>
              )}
            </div>
            <div className="block">
              <PrimaryButton type="submit">Create</PrimaryButton>
            </div>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
