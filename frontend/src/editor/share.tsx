import { ComponentProps, useState } from 'react';

import { IconButton, LoadingSpinnerButton, SecondaryButton } from '../components/button';
import { Checkbox, FormControl, Input } from '../components/form';
import { Modal } from '../components/modal';
import { deleteShareToken, shareDocument, useListShareTokens } from '../api/document';
import { IoIosTrash } from 'react-icons/io';
import { HiOutlineClipboardCopy } from 'react-icons/hi';
import clsx from 'clsx';
import { DialogSeparator } from '../components/dialog';

type ShareToken = ReturnType<typeof useListShareTokens>['data'][0];

function pad(number: number) {
  if (number < 10) {
    return '0' + number;
  }
  return number;
}

function formatDate(date: Date) {
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

function getInNDays(n: number) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + n); // setDate automatically fixes the date if we go beyond the month
  return tomorrow;
}

function getShareUrl(token: string) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  params.set('share_token', token);
  url.search = params.toString();
  return url.toString();
}

export function ShareTokenTable({
  shareTokens,
  documentId,
  mutateShareTokens,
}: {
  shareTokens: ShareToken[];
  documentId: string;
  mutateShareTokens: () => void;
}): JSX.Element {
  if (!shareTokens || shareTokens.length == 0) {
    return <></>;
  }
  return (
    <>
      <DialogSeparator />
      <div>
        <h3>Existing Share Tokens</h3>
        <table className="table-auto border-separate border-spacing-1 w-full">
          <thead>
            <tr>
              <td>Name</td>
              <td>Valid Until</td>
              <td></td>
            </tr>
          </thead>
          <tbody>
            {shareTokens.map((token, i) => (
              <tr key={token.id || i}>
                <td>{token.name}</td>
                <td>
                  {token.valid_until ? new Date(token.valid_until).toLocaleString() : 'Unlimited'}
                </td>
                <td>
                  <IconButton
                    icon={IoIosTrash}
                    label={'delete share token'}
                    onClick={async () => {
                      try {
                        await deleteShareToken({ document_id: documentId, token_id: token.id });
                      } catch (e) {
                        /* empty */
                      }
                      mutateShareTokens();
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function ShareModal({
  onClose,
  documentId,
  ...props
}: {
  onClose: () => void;
  documentId: string;
} & Omit<ComponentProps<typeof Modal>, 'label'>) {
  const [name, setName] = useState('Unnamed');
  const [limitValidity, setLimitValidity] = useState(true);
  const [maxValidity, setMaxValidity] = useState(getInNDays(7));
  const [newToken, setNewToken] = useState(null as string | null);
  const [loading, setLoading] = useState(false);

  const { data: shareTokens, mutate: mutateShareTokens } = useListShareTokens({
    document_id: documentId,
  });

  return (
    <Modal {...props} onClose={onClose} label="Share …">
      <form
        className="flex flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try {
            const { data } = await shareDocument({
              document_id: documentId,
              name,
              valid_until: limitValidity ? maxValidity.toISOString() : undefined,
            });
            setNewToken(data.share_token);
            mutateShareTokens();
          } catch (e) {
            /* empty */
          }
          setLoading(false);
        }}
      >
        <FormControl label={'Name'}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormControl>
        <Checkbox
          label="Limit validity"
          value={limitValidity}
          onChange={(x) => setLimitValidity(x)}
        />
        <FormControl label={'Valid until'}>
          <Input
            autoFocus
            value={maxValidity !== null ? formatDate(maxValidity) : undefined}
            type="datetime-local"
            onChange={(e) => {
              const target = e.target as { valueAsDate: Date };
              setMaxValidity(target.valueAsDate);
            }}
            disabled={!limitValidity}
          />
        </FormControl>
        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <LoadingSpinnerButton loading={loading} variant="primary" type="submit">
            Share
          </LoadingSpinnerButton>
        </div>
      </form>
      {newToken && (
        <div className="pt-4">
          <h3 className="pb-1">Share Link</h3>
          <div className={clsx('flex flex-row items-center ')}>
            <Input className="flex-grow" readOnly value={getShareUrl(newToken)}></Input>
            <IconButton
              className="flex-grow-0"
              icon={HiOutlineClipboardCopy}
              label={'copy to clipboard'}
              onClick={() => navigator.clipboard.writeText(getShareUrl(newToken))}
            />
          </div>
        </div>
      )}
      <ShareTokenTable
        shareTokens={shareTokens}
        mutateShareTokens={mutateShareTokens}
        documentId={documentId}
      />
    </Modal>
  );
}
