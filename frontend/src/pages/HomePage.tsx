import { useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import clsx from 'clsx';

import { BASE_URL } from '../api';

type FieldValues = {
  name: string;
  audioFile: FileList;
};

export default function HomePage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>();

  const [dropIndicator, setDropIndicator] = useState(false);

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    const formData  = new FormData();
    formData.append("name", data.name);
    formData.append("audio_file", data.audioFile[0]);

    await fetch(BASE_URL + "v1/documents/", {
      method: "POST",
      body: formData,
    });
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="w-96">
        <div className="p-6 bg-white border-black border-2 shadow-brutal rounded-lg">
          <h2 className="font-bold text-lg mb-4">Create Document</h2>
          <form onSubmit={handleSubmit(submitHandler)}>
            <div className="flex flex-col gap-6">
              <label className="block">
                <span className="text-sm font-medium">Name</span>
                <input
                  {...register('name', { required: true })}
                  className="block w-full form-input rounded border-2 border-black mt-0.5"
                />
                {errors.name && <p className="text-red-600">Name is required.</p>}
              </label>

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
                {errors.audioFile && <p className="text-red-600">File is required.</p>}
              </div>
              <div className="block">
                <button
                  type="submit"
                  className={clsx(
                    'bg-black',
                    'hover:bg-gray-700',
                    'rounded-md',
                    'text-white',
                    'py-2',
                    'px-4',
                  )}
                >
                  Create
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
