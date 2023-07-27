import { ComponentProps, useContext, useCallback } from 'react';
import { ReactEditor, useSlateStatic } from 'slate-react';
import * as Automerge from '@automerge/automerge';

import { Document, Paragraph } from './types';
import { PrimaryButton, SecondaryButton } from '../components/button';
import { IoIosAdd, IoIosCreate, IoIosTrash } from 'react-icons/io';
import { Dropdown, DropdownItem, DropdownSection } from '../components/dropdown';
import { Input } from '../components/form';
import { getSpeakerName, useSpeakerName, useSpeakerNames } from '../utils/document';
import { showModal, Modal } from '../components/modal';
import { SpeakerColorsContext } from './speaker_colors';
import { Editor, Transforms } from 'slate';
import clsx from 'clsx';

export function calculateParagraphIdxOfSpeakerEnd(editor: Editor, idx: number): number {
  const speaker = editor.doc.children[idx].speaker;

  let speakerEndIdx;
  for (
    speakerEndIdx = idx;
    speakerEndIdx < editor.doc.children.length &&
    editor.doc.children[speakerEndIdx].speaker == speaker;
    speakerEndIdx++
  );

  return speakerEndIdx - 1;
}

function SpeakerNamesSection({
  editor,
  onSpeakerSelected,
  currentSpeaker,
  ...props
}: {
  editor: Editor;
  onSpeakerSelected: (speakerId: string) => void;
  currentSpeaker: string | null;
} & ComponentProps<typeof DropdownSection>) {
  const speakerColors = useContext(SpeakerColorsContext);
  const speakerNames = useSpeakerNames(editor);

  return (
    <DropdownSection {...props}>
      {Object.entries(speakerNames).map(([k, v]) => (
        <DropdownItem
          key={k}
          onClick={() => onSpeakerSelected(k)}
          className={clsx('relative', k == currentSpeaker && 'font-bold')}
        >
          <div
            className="absolute top-1 w-2 h-[calc(100%-8px)] ml-1.5 rounded-xl"
            style={{ background: speakerColors[k] }}
          />
          <div className="text-left ml-5 break-word">{v}</div>
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
  const endPath = calculateParagraphIdxOfSpeakerEnd(editor, path[0]);

  Transforms.setNodes(
    editor,
    { speaker },
    {
      at: {
        anchor: { path, offset: 0 },
        focus: { path: [endPath], offset: 0 },
      },
      match: (n) => 'speaker' in n, // we only match paragraph nodes
    },
  );
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
  const editor = useSlateStatic();
  const name = useSpeakerName(paragraph.speaker, editor);

  const renameSpeaker = () => {
    const speaker = paragraph.speaker;
    if (speaker !== null) {
      showModal(
        <SpeakerNameModal
          label="Rename Speaker"
          onClose={() => showModal(null)}
          initialValue={name}
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
          const elementPath = ReactEditor.findPath(editor, paragraph);
          const speakerId = addNewSpeaker(editor, speakerName);
          setSpeaker(editor, elementPath, speakerId);
        }}
      />,
    );
  };
  const unsetSpeaker = () => {
    const elementPath = ReactEditor.findPath(editor, paragraph);
    setSpeaker(editor, elementPath, null);
  };

  return (
    <Dropdown
      {...props}
      label={getSpeakerName(paragraph.speaker, editor.doc.speaker_names)}
      dropdownClassName="min-w-[210px]"
    >
      <SpeakerNamesSection
        editor={editor}
        onSpeakerSelected={(speakerId) => {
          const elementPath = ReactEditor.findPath(editor, paragraph);
          setSpeaker(editor, elementPath, speakerId);
        }}
        currentSpeaker={paragraph.speaker}
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
