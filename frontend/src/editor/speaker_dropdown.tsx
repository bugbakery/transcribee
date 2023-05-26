import { ComponentProps, useContext, useCallback } from 'react';
import { Editor } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';
import * as Automerge from '@automerge/automerge';

import { Document, Paragraph } from './types';
import { PrimaryButton, SecondaryButton } from '../components/button';
import { IoIosAdd, IoIosCreate, IoIosTrash } from 'react-icons/io';
import { Dropdown, DropdownItem, DropdownSection } from '../components/dropdown';
import { Input } from '../components/form';
import { getSpeakerName, useSpeakerNames } from '../utils/document';
import { showModal, Modal } from '../components/modal';
import { SpeakerColorsContext } from './speaker_colors';

function SpeakerNamesSection({
  editor,
  onSpeakerSelected,
  ...props
}: {
  editor: Editor;
  onSpeakerSelected: (speakerId: string) => void;
} & ComponentProps<typeof DropdownSection>) {
  const speakerColors = useContext(SpeakerColorsContext);
  const speakerNames = useSpeakerNames(editor);

  return (
    <DropdownSection {...props}>
      {Object.entries(speakerNames).map(([k, v]) => (
        <DropdownItem key={k} onClick={() => onSpeakerSelected(k)}>
          <span
            className="w-2 h-6 min-h-full ml-1.5 mr-3.5 rounded-xl"
            style={{ background: speakerColors[k] }}
          />
          {v}
        </DropdownItem>
      ))}
      {props.children}
    </DropdownSection>
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
} & ComponentProps<typeof Modal>) {
  return (
    <Modal {...props} onClose={onClose}>
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

function setSpeaker(editor: Editor, path: number[], speaker: string | null) {
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

export function SpeakerDropdown({
  paragraph,
  ...props
}: { paragraph: Paragraph } & Omit<ComponentProps<typeof Dropdown>, 'label'>) {
  const editor: Editor = useSlate();

  const elementPath = ReactEditor.findPath(editor, paragraph);
  const doc: Automerge.Doc<Document> = editor.doc;
  const renameSpeaker = () => {
    const speaker = paragraph.speaker;
    if (speaker !== null) {
      showModal(
        <SpeakerNameModal
          label="Rename Speaker"
          onClose={() => showModal(null)}
          initialValue={getSpeakerName(paragraph.speaker, doc.speaker_names)}
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
  const addSpeaker = () => {
    showModal(
      <SpeakerNameModal
        label="New Speaker"
        onClose={() => showModal(null)}
        initialValue=""
        selectedCallback={(speakerName) => {
          if (!speakerName) return;
          const speakerId = addNewSpeaker(editor, speakerName);
          setSpeaker(editor, elementPath, speakerId);
        }}
      />,
    );
  };
  const unsetSpeaker = () => setSpeaker(editor, elementPath, null);

  return (
    <Dropdown
      {...props}
      label={getSpeakerName(paragraph.speaker, editor.doc.speaker_names)}
      dropdownClassName="min-w-[190px]"
    >
      <SpeakerNamesSection
        editor={editor}
        onSpeakerSelected={(speakerId) => setSpeaker(editor, elementPath, speakerId)}
      >
        <DropdownItem icon={IoIosAdd} onClick={addSpeaker}>
          New Speaker
        </DropdownItem>
      </SpeakerNamesSection>
      <DropdownSection>
        <DropdownItem
          icon={IoIosCreate}
          onClick={renameSpeaker}
          disabled={paragraph.speaker === null || paragraph.speaker === undefined}
        >
          Rename Speaker
        </DropdownItem>
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
