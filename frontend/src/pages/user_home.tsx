import clsx from 'clsx';
import { Link } from 'wouter';
import * as Automerge from '@automerge/automerge';
import { AiOutlinePlus } from 'react-icons/ai';
import { FaFileImport } from 'react-icons/fa';
import { IoIosMore, IoIosTrash } from 'react-icons/io';
import { KeyedMutator } from 'swr';
import { deleteDocument, replaceChanges, useListDocuments } from '../api/document';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/top_bar';
import { Version } from '../common/version';
import { AppContainer } from '../components/app';
import { SecondaryButton, PrimaryButton } from '../components/button';
import { showModal, Modal } from '../components/modal';
import { ComponentProps, useRef, useState } from 'react';
import { DropdownItem, DropdownSection, IconDropdown } from '../components/dropdown';
import { useDebugMode } from '../debugMode';

type DocumentInfo = ReturnType<typeof useListDocuments>['data'][0];

export function UserHomePage() {
  const { data, mutate } = useListDocuments({});
  const debugMode = useDebugMode();

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart>
          <TopBarTitle>transcribee</TopBarTitle>
        </TopBarPart>

        <TopBarPart>
          <MeButton />
        </TopBarPart>
      </TopBar>

      <ul
        className={clsx(
          'grid',
          'grid-cols-2',
          'sm:grid-cols-3',
          'md:grid-cols-4',
          'lg:grid-cols-5',
          'xl:grid-cols-6',
          'gap-6',
        )}
      >
        {data?.map((doc) => {
          return DocumentCard(doc, mutate, debugMode);
        })}

        <li>
          <Link
            title="create new document"
            aria-label="create new document"
            to={`/new`}
            className={clsx(
              'block',
              'p-4',
              'aspect-square',
              'bg-white dark:bg-neutral-900',
              'font-medium',
              'rounded-lg',
              'border',
              'border-gray-200 dark:border-neutral-600',
              'hover:shadow-lg',
              'hover:scale-105',
              'transition-all',
              'flex',
            )}
          >
            {' '}
            <AiOutlinePlus size={28} />
          </Link>
        </li>
      </ul>

      <Version />
    </AppContainer>
  );
}
function DocumentCard(
  doc: DocumentInfo,
  mutate: KeyedMutator<DocumentInfo[]>,
  debugMode: boolean,
): JSX.Element {
  return (
    <li key={doc.id}>
      <Link
        to={`document/${doc.id}`}
        className={clsx(
          'w-full h-full',
          'flex flex-col',
          'items-stretch justify-between',
          'p-4',
          'aspect-square',
          'bg-white dark:bg-neutral-900',
          'font-medium',
          'rounded-lg',
          'border',
          'border-gray-200 dark:border-neutral-600',
          'hover:shadow-lg',
          'hover:scale-105',
          'transition-all',
          'break-word',
        )}
      >
        <IconDropdown icon={IoIosMore} className={clsx('self-end -m-2')}>
          <DropdownSection>
            {debugMode && (
              <DropdownItem
                icon={FaFileImport}
                onClick={(e) => {
                  e.preventDefault();
                  showModal(
                    <ImportStateModal document_id={doc.id} onClose={() => showModal(null)} />,
                  );
                }}
              >
                Import Document State
              </DropdownItem>
            )}
            <DropdownItem
              icon={IoIosTrash}
              onClick={(e) => {
                e.preventDefault();
                // TODO: Replace with modal
                if (confirm(`Are you sure you want to delete ${doc.name}?`)) {
                  // mutate marks the document list as stale, so SWR refreshes it
                  deleteDocument({ document_id: doc.id }).then(() => mutate());
                }
              }}
            >
              Delete Document
            </DropdownItem>
          </DropdownSection>
        </IconDropdown>
        {doc.name}
      </Link>
    </li>
  );
}

export function FileInput({ accept, name }: { accept: string; name: string }): JSX.Element {
  const [dropIndicator, setDropIndicator] = useState(false);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const [audioFile, setAudioFile] = useState(null as FileList | null);

  return (
    <div>
      <div
        className={clsx(
          'border-2',
          'border-b-0',
          'border-black dark:border-neutral-200',
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

          setAudioFile(e.dataTransfer.files);

          if (audioFileRef.current) {
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
            'border-black dark:border-neutral-200',
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
              ref={(ref) => {
                audioFileRef.current = ref;
              }}
              type="file"
              className="opacity-0 absolute peer w-full"
              accept={accept}
              onChange={(e) => setAudioFile(e.target.files)}
              name={name}
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
        {audioFile?.[0]?.name || 'No file selected.'}
      </div>
      {audioFile === null && <p className="text-red-600 text-sm mt-0.5">File is required.</p>}
    </div>
  );
}
export function ImportStateModal({
  onClose,
  document_id,
  ...props
}: { document_id: string } & Omit<ComponentProps<typeof Modal>, 'label'>) {
  const [errorMessage, setErrorMessage] = useState('');
  return (
    <Modal {...props} onClose={onClose} label="Import Document State">
      <form
        className="flex flex-col gap-6"
        onSubmit={async (e) => {
          const target = e.target as typeof e.target & { file: { files: FileList } };
          e.preventDefault();
          const file = target.file.files[0];
          const doc = Automerge.load(new Uint8Array(await file.arrayBuffer()));
          const changes = Automerge.getChanges(Automerge.init(), doc);
          try {
            await replaceChanges({
              document_id,
              document_updates: changes.map((x) => new Blob([x])),
            });
            onClose && onClose();
          } catch (e) {
            let message = 'An unknown error occcured.';

            if (e instanceof replaceChanges.Error) {
              const error = e.getActualType();
              if (error.status === 422) {
                if (error.data.detail) {
                  message = error.data.detail.map((x) => x.msg).join(' ');
                }
              }
            }

            setErrorMessage(message);
          }
        }}
      >
        <FileInput accept=".automerge" name="file"></FileInput>
        {errorMessage && <p className="text-red-600 text-sm mt-0.5">{errorMessage}</p>}

        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit">Import</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
