import { memo, useState, useCallback } from 'react';
import { Editor } from 'slate';
import { useSlateStatic, ReactEditor } from 'slate-react';
import * as Automerge from '@automerge/automerge';

import { Document, Paragraph } from './types';
import { PrimaryButton, SecondaryButton } from '../components/button';
import { IoIosCreate, IoIosList, IoIosTrash } from 'react-icons/io';
import { Dropdown, DropdownItem, DropdownSection } from '../components/dropdown';
import { Input, Select } from '../components/form';
import { useSpeakerName, useSpeakerNames } from '../utils/document';
import { showModal, Modal, ModalProps } from '../components/modal';

function SelectSpeakerModal({
  editor,
  onSpeakerSelected,
  onNewSpeaker,
  onClose,
  selected,
  ...props
}: {
  editor: Editor;
  onSpeakerSelected: (speakerId: string) => void;
  onNewSpeaker: (speakerName: string) => void;
  onClose: () => void;
  selected: string | null;
} & Omit<ModalProps, 'label'>) {
  const NEW_SPEAKER_OPTION = '__new_speaker';

  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState<string>('');

  const speakerNames = useSpeakerNames(editor);

  if (speakerId === null && selected !== null && selected in speakerNames) {
    setSpeakerId(selected);
  } else if (speakerId === null && Object.keys(speakerNames).length > 0) {
    setSpeakerId(Object.keys(speakerNames)[0]);
  } else if (speakerId === null && Object.keys(speakerNames).length === 0) {
    setSpeakerId(NEW_SPEAKER_OPTION);
  }

  const setSpeakerNameFromEvent = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const target = e.target as typeof e.target & { value: string };
      setSpeakerName(target.value);
    },
    [setSpeakerName],
  );

  return (
    <Modal {...props} onClose={onClose} label="Select Speaker">
      <form
        className="flex flex-col gap-6"
        onSubmit={useCallback(
          (e: React.SyntheticEvent) => {
            e.preventDefault();
            if (speakerId === NEW_SPEAKER_OPTION) {
              onClose();
              onNewSpeaker(speakerName);
            } else if (speakerId !== null) {
              onClose();
              onSpeakerSelected(speakerId);
            }
          },
          [speakerId, speakerName],
        )}
      >
        <Select
          autoFocus
          value={speakerId !== null ? speakerId : undefined}
          onChange={useCallback((e: React.SyntheticEvent) => {
            const target = e.target as typeof e.target & { value: string };
            setSpeakerId(target.value);
          }, [])}
        >
          {Object.entries(speakerNames).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
          <option value={NEW_SPEAKER_OPTION}>New Speaker</option>
        </Select>
        {speakerId === NEW_SPEAKER_OPTION ? (
          <Input
            autoFocus
            name="speaker_name"
            value={speakerName}
            onChange={setSpeakerNameFromEvent}
          />
        ) : (
          <></>
        )}
        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit">Select</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function SpeakerNameModal({
  selectedCallback,
  onClose,
  initialValue,
  ...props
}: {
  selectedCallback: (speakerName: string) => void;
  onClose: () => void;
  initialValue: string;
} & Omit<ModalProps, 'label'>) {
  return (
    <Modal {...props} onClose={onClose} label="Rename Speaker">
      <form
        className="flex flex-col gap-6"
        onSubmit={useCallback((e: React.SyntheticEvent) => {
          const target = e.target as typeof e.target & { speaker_name: { value: string } };
          e.preventDefault();
          onClose();
          selectedCallback(target.speaker_name.value);
        }, [])}
      >
        <Input autoFocus name="speaker_name" defaultValue={initialValue} />
        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit">Select</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function setSpeaker(editor: Editor, node: Paragraph, speaker: string | null) {
  const path = ReactEditor.findPath(editor, node);
  editor.apply({
    type: 'set_node',
    path: path,
    properties: {},
    newProperties: { speaker },
  });
}

function addNewSpeaker(editor: Editor, speakerName: string): string {
  const speakerId = crypto.randomUUID();
  const newDoc = Automerge.change(editor.doc, (draft: Document) => {
    draft.speaker_names[speakerId] = speakerName;
  });
  editor.setDoc(newDoc);
  return speakerId;
}

function changeSpeakerName(editor: Editor, speakerId: string, speakerName: string) {
  const newDoc = Automerge.change(editor.doc, (draft: Document) => {
    draft.speaker_names[speakerId] = speakerName;
  });
  editor.setDoc(newDoc);
}

export const SpeakerDropdown = memo(({ paragraph }: { paragraph: Paragraph }) => {
  const speaker = paragraph.speaker;
  const editor: Editor = useSlateStatic();
  const speakerName = useSpeakerName(speaker);
  const changeSpeaker = useCallback(() => {
    showModal(
      <SelectSpeakerModal
        editor={editor}
        selected={speaker}
        onClose={() => showModal(null)}
        onSpeakerSelected={(speakerId) => setSpeaker(editor, paragraph, speakerId)}
        onNewSpeaker={(speakerName) => {
          const speakerId = addNewSpeaker(editor, speakerName);
          setSpeaker(editor, paragraph, speakerId);
        }}
      />,
    );
  }, [speaker, paragraph, editor]);

  const renameSpeaker = useCallback(() => {
    if (speaker !== null && speaker !== undefined) {
      showModal(
        <SpeakerNameModal
          onClose={() => showModal(null)}
          initialValue={speakerName}
          selectedCallback={(speakerName: string) => {
            changeSpeakerName(editor, speaker, speakerName);
          }}
        />,
      );
    }
  }, [speaker, speakerName, editor]);

  const unsetSpeaker = useCallback(() => setSpeaker(editor, paragraph, null), [editor, paragraph]);

  return (
    <Dropdown label={speakerName} className="pr-4">
      <DropdownSection>
        <DropdownItem icon={IoIosList} onClick={changeSpeaker}>
          Change Speaker
        </DropdownItem>
        <DropdownItem
          icon={IoIosCreate}
          onClick={renameSpeaker}
          disabled={speaker === null || speaker === undefined}
        >
          Rename Speaker
        </DropdownItem>
      </DropdownSection>
      <DropdownSection>
        <DropdownItem
          icon={IoIosTrash}
          onClick={unsetSpeaker}
          disabled={speaker === null || speaker === undefined}
        >
          Unset Speaker
        </DropdownItem>
      </DropdownSection>
    </Dropdown>
  );
});

SpeakerDropdown.displayName = 'SpeakerDropdown';
