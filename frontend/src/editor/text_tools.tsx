import { TbHammer } from 'react-icons/tb';
import { IconButton } from '../components/button';
import { EditorWithWebsocket } from './automerge_websocket_editor';
import { Document, Paragraph } from '../editor/types';
import { Popup } from '../components/popup';
import { primitiveWithClassname } from '../styled';

export const MenuItemButton = primitiveWithClassname('button', [
  'hover:bg-gray-200 dark:hover:bg-neutral-700',
  'rounded-md',
  'w-full',
  'text-left',
  'px-2',
  'py-1',
  'block',
]);

export function TextTools({ editor }: { editor: EditorWithWebsocket }) {
  return (
    <Popup
      button={<IconButton icon={TbHammer} label={'text tools'} />}
      onClick={(e) => {
        e.preventDefault();
      }}
    >
      <MenuItemButton
        onClick={() => {
          const mergePoints: number[] = [];
          for (let i = 0; i < editor.doc.children.length - 1; i++) {
            const paragraph = editor.doc.children[i];
            const nextParagraph = editor.doc.children[i + 1];
            if (paragraph.speaker == nextParagraph.speaker) {
              mergePoints.push(i);
            }
          }
          editor.update((doc: Document) => {
            let removed = 0;
            mergePoints.forEach((index) => {
              const i = index - removed;
              doc.children[i].children.push(
                ...JSON.parse(JSON.stringify(doc.children[i + 1].children)),
              );
              doc.children.splice(i + 1, 1);
              removed++;
            });
          });
        }}
      >
        Reflow to One Paragraph per Speaker
      </MenuItemButton>

      <MenuItemButton
        onClick={() => {
          const punctuations = ['.', '?', '!'];
          const non_punctuations = ['...'];
          const contains_punctuation = (text: string) =>
            punctuations.some((punct) => text.includes(punct)) &&
            !non_punctuations.some((np) => text.includes(np));

          // stategy: we first merge everything that could possibly be merged...
          const mergePoints: number[] = [];
          for (let i = 0; i < editor.doc.children.length - 1; i++) {
            const paragraph = editor.doc.children[i];
            const nextParagraph = editor.doc.children[i + 1];
            if (
              !contains_punctuation(paragraph.children[paragraph.children.length - 1].text) &&
              paragraph.speaker == nextParagraph.speaker
            ) {
              mergePoints.push(i);
            }
          }
          editor.update((doc: Document) => {
            let removed = 0;
            mergePoints.forEach((index) => {
              const i = index - removed;
              doc.children[i].children.push(
                ...JSON.parse(JSON.stringify(doc.children[i + 1].children)),
              );
              doc.children.splice(i + 1, 1);
              removed++;
            });

            // ...and only then break up
            const newChildren: Paragraph[] = [];
            doc.children.forEach((paragraph) => {
              let currentParagraph = {
                ...paragraph,
                children: [] as { text: string }[],
              };
              paragraph.children.forEach((token) => {
                currentParagraph.children.push(JSON.parse(JSON.stringify(token)));
                if (contains_punctuation(token.text)) {
                  newChildren.push(currentParagraph);
                  currentParagraph = {
                    ...paragraph,
                    children: [],
                  };
                }
              });
              if (currentParagraph.children.length > 0) {
                newChildren.push(currentParagraph);
              }
            });
            doc.children = newChildren;
          });
        }}
      >
        Reflow to One Paragraph per Sentence
      </MenuItemButton>
    </Popup>
  );
}
