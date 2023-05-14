import { useMemo, useState } from 'react';
import { useSlate, ReactEditor } from 'slate-react';
import * as Automerge from '@automerge/automerge';
import { AutomergeEditor } from 'slate-automerge-doc';

import { Document, Paragraph } from './types';
import { PrimaryButton, SecondaryButton } from '../components/button';
import { IoIosCreate, IoIosList, IoIosTrash } from 'react-icons/io';
import { Dropdown, DropdownItem, DropdownSection } from '../components/dropdown';
import { Input, Select } from '../components/form';
import { showModal, Modal, ModalProps } from '../components/modal';

export function getSpeakerName(element: Paragraph, speaker_names: Record<string, string>): string {
  if (!element.speaker) {
    return `Unknown Speaker`;
  } else if (element.speaker in speaker_names) {
    return speaker_names[element.speaker];
  } else {
    return `Unnamed Speaker ${element.speaker}`;
  }
}

function SelectSpeakerModal({
  doc,
  onSpeakerSelected,
  onNewSpeaker,
  onClose,
  selected,
  ...props
}: {
  doc: Automerge.Doc<Document>;
  onSpeakerSelected: (speakerId: string) => void;
  onNewSpeaker: (speakerName: string) => void;
  onClose: () => void;
  selected?: string;
} & Omit<ModalProps, 'label'>) {
  const NEW_SPEAKER_OPTION = '__new_speaker';

  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState<string>('');

  const speakerNames = useMemo(() => {
    const spkNames: Record<string, string> = {};
    for (const para of doc.children) {
      if (para.speaker !== null && !(para.speaker in spkNames)) {
        spkNames[para.speaker] = getSpeakerName(para, doc.speaker_names);
      }
    }
    return spkNames;
  }, [doc.speaker_names]);

  if (speakerId === null && selected !== undefined && selected in speakerNames) {
    setSpeakerId(selected);
  } else if (speakerId === null && Object.keys(speakerNames).length > 0) {
    setSpeakerId(Object.keys(speakerNames)[0]);
  } else if (speakerId === null && Object.keys(speakerNames).length === 0) {
    setSpeakerId(NEW_SPEAKER_OPTION);
  }

  return (
    <Modal {...props} onClose={onClose} label="Select Speaker">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (speakerId === NEW_SPEAKER_OPTION) {
            onClose();
            onNewSpeaker(speakerName);
          } else if (speakerId !== null) {
            onClose();
            onSpeakerSelected(speakerId);
          }
        }}
      >
        <Select
          autoFocus
          value={speakerId !== null ? speakerId : undefined}
          onChange={(e) => {
            setSpeakerId(e.target.value);
          }}
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
            onChange={(e) => {
              setSpeakerName(e.target.value);
            }}
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
  const [value, setValue] = useState(initialValue);

  return (
    <Modal {...props} onClose={onClose} label="Rename Speaker">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          selectedCallback(value);
        }}
      >
        <Input
          autoFocus
          name="speaker_name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
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

function setSpeaker(editor: AutomergeEditor, path: number[], speaker: string | null) {
  editor.apply({
    type: 'set_node',
    path: path,
    properties: {},
    newProperties: { speaker },
  });
}

function addNewSpeaker(editor: AutomergeEditor, speakerName: string): string {
  const speakerId = crypto.randomUUID();
  const newDoc = Automerge.change(editor.doc, (draft: Document) => {
    draft.speaker_names[speakerId] = speakerName;
  });
  editor.setDoc(newDoc);
  if (editor.onDocChange) {
    editor.onDocChange(newDoc);
  }
  return speakerId;
}

function changeSpeakerName(editor: AutomergeEditor, speakerId: string, speakerName: string) {
  const newDoc = Automerge.change(editor.doc, (draft: Document) => {
    draft.speaker_names[speakerId] = speakerName;
  });
  editor.setDoc(newDoc);
  if (editor.onDocChange) {
    editor.onDocChange(newDoc);
  }
}

export function SpeakerDropdown({ paragraph }: { paragraph: Paragraph }) {
  const editor: ReactEditor & AutomergeEditor = useSlate();

  const elementPath = ReactEditor.findPath(editor, paragraph);
  const doc: Automerge.Doc<Document> = editor.doc;
  const changeSpeaker = () => {
    showModal(
      <SelectSpeakerModal
        doc={doc}
        selected={paragraph.speaker?.toString()}
        onClose={() => showModal(null)}
        onSpeakerSelected={(speakerId) => setSpeaker(editor, elementPath, speakerId)}
        onNewSpeaker={(speakerName) => {
          const speakerId = addNewSpeaker(editor, speakerName);
          setSpeaker(editor, elementPath, speakerId);
        }}
      />,
    );
  };
  const renameSpeaker = () => {
    const speaker = paragraph.speaker;
    if (speaker !== null) {
      showModal(
        <SpeakerNameModal
          onClose={() => showModal(null)}
          initialValue={getSpeakerName(paragraph, doc.speaker_names)}
          selectedCallback={(speakerName) => {
            changeSpeakerName(editor, speaker, speakerName);

            // No-op to trigger a re-render of the editor so the speaker name gets applied
            editor.apply({
              type: 'set_node',
              path: [0],
              properties: {},
              newProperties: {},
            });
          }}
        />,
      );
    }
  };
  const unsetSpeaker = () => setSpeaker(editor, elementPath, null);

  return (
    <Dropdown label={getSpeakerName(paragraph, editor.doc.speaker_names)}>
      <DropdownSection>
        <DropdownItem icon={IoIosList} onClick={changeSpeaker}>
          Change Speaker
        </DropdownItem>
        <DropdownItem
          icon={IoIosCreate}
          onClick={renameSpeaker}
          disabled={paragraph.speaker === null || paragraph.speaker === undefined}
        >
          Rename Speaker
        </DropdownItem>
      </DropdownSection>
      <DropdownSection>
        <DropdownItem
          icon={IoIosTrash}
          onClick={unsetSpeaker}
          disabled={paragraph.speaker === null || paragraph.speaker === undefined}
        >
          Unset Speaker
        </DropdownItem>
      </DropdownSection>
    </Dropdown>
  );
}
