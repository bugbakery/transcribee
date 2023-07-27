import { ComponentProps, useState } from 'react';

import { IconButton, LoadingSpinnerButton, SecondaryButton } from '../components/button';
import { Checkbox, FormControl, Input } from '../components/form';
import { DoubleWidthModal, Modal } from '../components/modal';
import { deleteShareToken, shareDocument, useListShareTokens } from '../api/document';
import { IoIosTrash } from 'react-icons/io';
import { HiOutlineClipboardCopy } from 'react-icons/hi';
import clsx from 'clsx';
import { DialogSeparator } from '../components/dialog';
import { Tooltip } from '../components/tooltip';

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

export function ShareTokenTableRow({
  token,
  documentId,
  mutateShareTokens,
}: {
  token: ShareToken;
  documentId: string;
  mutateShareTokens: () => void;
}): JSX.Element {
  const [tooltipText, setTooltipText] = useState(null as string | null);
  return (
    <tr>
      <td>{token.name}</td>
      <td>{token.valid_until ? new Date(token.valid_until).toLocaleString() : 'Unlimited'}</td>
      <td>{token.can_write ? 'Yes' : 'No'}</td>
      <td className="w-20">
        <Tooltip tooltipText={tooltipText} className="inline">
          <IconButton
            icon={HiOutlineClipboardCopy}
            label={'copy to clipboard'}
            onClick={() => {
              navigator.clipboard.writeText(getShareUrl(token.token));
              setTooltipText('copied');
              setTimeout(() => setTooltipText(null), 1000);
            }}
          />
        </Tooltip>
        <IconButton
          icon={IoIosTrash}
          label={'delete share link'}
          onClick={async () => {
            try {
              await deleteShareToken({ document_id: documentId, token_id: token.id });
            } catch (e) {
              /* empty */
            }
            mutateShareTokens();
          }}
        />
        {/* </div> */}
      </td>
    </tr>
  );
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
    return (
      <div className="w-full">
        <h3>Existing Share Links</h3>
        No share links were created for this document so far.
      </div>
    );
  }
  return (
    <div>
      <h3 className="pb-4 font-bold">Existing Share Links</h3>
      <table className="table-auto border-separate border-spacing-x-2 w-full">
        <thead>
          <tr>
            <td>Name</td>
            <td>Valid Until</td>
            <td>Can Write</td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          {shareTokens.map((token) => (
            <ShareTokenTableRow
              token={token}
              documentId={documentId}
              mutateShareTokens={mutateShareTokens}
              key={token.id}
            />
          ))}
        </tbody>
      </table>
    </div>
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
  const [canWrite, setCanWrite] = useState(true);
  const [limitValidity, setLimitValidity] = useState(false);
  const [maxValidity, setMaxValidity] = useState(getInNDays(7));
  const [newToken, setNewToken] = useState(null as string | null);
  const [loading, setLoading] = useState(false);

  const { data: shareTokens, mutate: mutateShareTokens } = useListShareTokens({
    document_id: documentId,
  });

  return (
    <DoubleWidthModal {...props} onClose={onClose} label="Share">
      <DialogSeparator className="mb-0" />
      <div className="flex flex-col sm:flex-row">
        <section className="w-full sm:w-1/2 pb-6 sm:pb-0 sm:pr-6 pt-4">
          <h3 className="pb-4 font-bold">Create New Share Link</h3>
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
                  can_write: canWrite,
                });
                setNewToken(data.token);
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
            <Checkbox label="Can Edit Document" value={canWrite} onChange={(x) => setCanWrite(x)} />
            <Checkbox
              label="Set expire date"
              value={limitValidity}
              onChange={(x) => setLimitValidity(x)}
            />
            {limitValidity && (
              <FormControl label={'Valid until'}>
                <Input
                  autoFocus
                  value={maxValidity !== null ? formatDate(maxValidity) : undefined}
                  type="datetime-local"
                  onChange={(e) => {
                    setMaxValidity(new Date(e.target.value));
                  }}
                  disabled={!limitValidity}
                />
              </FormControl>
            )}
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
              <h4 className="pb-1">Share Link</h4>
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
        </section>
        <section className="w-full pt-4 border-t-2 sm:border-t-0 sm:border-l-2 sm:pb-6 sm:pl-6 sm:w-1/2 sm:-mb-6">
          <ShareTokenTable
            shareTokens={shareTokens}
            mutateShareTokens={mutateShareTokens}
            documentId={documentId}
          />
        </section>
      </div>
    </DoubleWidthModal>
  );
}
