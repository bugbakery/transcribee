import clsx from 'clsx';
import { useState } from 'react';

export type DropFilePickerProps = {
  className?: string | undefined;
  value: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string | undefined;
  placeholder?: string | undefined;
};

export function DropFilePicker({
  className,
  value,
  onFileChange,
  accept,
  placeholder,
}: DropFilePickerProps) {
  const [dropIndicator, setDropIndicator] = useState(false);

  return (
    <div className={className}>
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

          const file = e.dataTransfer.files[0];
          if (accept == undefined || fileAccepted(file, accept)) {
            onFileChange(file);
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
            <p className="font-medium">Drop to choose file…</p>
          </div>
        </div>
        <div
          className={clsx(
            'text-center max-w-full flex flex-col h-full justify-center',
            dropIndicator && 'hidden',
          )}
        >
          {value && (
            <>
              <p className="mx-4 mt-4 text-sm text-neutral-400 font-medium">Selected file</p>
              <div className="mx-4 flex-grow flex items-center mb-2">
                <p className="max-w-full break-words">{value.name}</p>
              </div>
            </>
          )}
          {!value && (
            <>
              <p className="font-medium">{placeholder || 'Drag file here'}</p>
              <p className="relative">
                or{' '}
                <input
                  onChange={(e) => {
                    if (!e.currentTarget.files) {
                      return;
                    }
                    const file = e.currentTarget.files[0];
                    if (accept == undefined || fileAccepted(file, accept)) {
                      onFileChange(file);
                    }
                  }}
                  type="file"
                  className="opacity-0 absolute peer w-full"
                  accept={accept}
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
        {(value && (
          <button
            type="button"
            onClick={() => {
              onFileChange(null);
            }}
            className="underline hover:opacity-60"
          >
            Remove selection
          </button>
        )) ||
          'No file selected.'}
      </div>
    </div>
  );
}

/**
 * Checks if file is accepted according to html accept attribute.
 * https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept
 */
function fileAccepted(file: File, accept: string) {
  const parts = accept.split(',');
  return parts.some((p) => {
    p = p.trim();

    if (p.startsWith('.')) {
      return file.name.toLowerCase().endsWith(p.toLowerCase());
    } else if (p.endsWith('/*')) {
      return file.type.startsWith(p.substring(0, p.length - 2));
    } else {
      return file.type == p;
    }
  });
}
