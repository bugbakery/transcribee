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

function mergeSameSpeakerParagraphs(doc: Document) {
  const mergePoints: number[] = [];
  for (let i = 0; i < doc.children.length - 1; i++) {
    const paragraph = doc.children[i];
    const nextParagraph = doc.children[i + 1];
    if (paragraph.speaker == nextParagraph.speaker) {
      mergePoints.push(i);
    }
  }
  let removed = 0;
  mergePoints.forEach((index) => {
    const i = index - removed;
    doc.children[i].children.push(...JSON.parse(JSON.stringify(doc.children[i + 1].children)));
    doc.children.splice(i + 1, 1);
    removed++;
  });
}

const punctuations = ['.', '?', '!'];
const non_punctuations = ['...'];
function containsSentenceEnd(text: string) {
  return (
    punctuations.some((punct) => text.includes(punct)) &&
    !non_punctuations.some((np) => text.includes(np))
  );
}

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
          editor.update(mergeSameSpeakerParagraphs);
        }}
      >
        Reflow to One Paragraph per Speaker
      </MenuItemButton>

      <MenuItemButton
        onClick={() => {
          editor.update((doc: Document) => {
            // stategy: we first merge everything that could possibly be merged...
            mergeSameSpeakerParagraphs(doc);

            // ...and only then break up on sentence boundaries
            const newChildren: Paragraph[] = [];
            doc.children.forEach((paragraph) => {
              let currentParagraph = {
                ...paragraph,
                children: [] as { text: string }[],
              };
              paragraph.children.forEach((token) => {
                currentParagraph.children.push(JSON.parse(JSON.stringify(token)));
                if (containsSentenceEnd(token.text)) {
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

      <MenuItemButton
        onClick={() => {
          // this strategy tries to split paragraphs at sentence boundaries, but only if there is a pause between the sentences
          // or the paragraphs would become too long.
          const initial = 2;
          const decay = 0.95;

          const getPause = (i: number, paragraph: Paragraph) => {
            const token = paragraph.children[i];
            const nextToken = paragraph.children[i + 1];
            if (nextToken?.start !== undefined && token?.end !== undefined) {
              return nextToken.start - token.end;
            }
            return 0;
          };

          editor.update((doc: Document) => {
            mergeSameSpeakerParagraphs(doc);
            const newChildren: Paragraph[] = [];
            const addNewChild = (paragraph: Paragraph) => {
              // if the paragraph is very long and does not contain any sentence ends, we still want to break it up
              if (paragraph.children.length <= 100) {
                newChildren.push(paragraph);
              } else {
                const silences = paragraph.children
                  .map((x, i) => ({ ...x, pause: getPause(i, paragraph) }))
                  .filter((token) => token.text.includes(','))
                  .map((token) => token.pause);
                silences.sort();
                const thresholdIndex = Math.floor(paragraph.children.length / 100); // aim for paragraphs of max ~50 tokens
                const threshold = silences[silences.length - 1 - thresholdIndex];
                let currentParagraph = {
                  ...paragraph,
                  children: [] as { text: string }[],
                };
                paragraph.children.forEach((token, i) => {
                  currentParagraph.children.push(JSON.parse(JSON.stringify(token)));
                  if (
                    getPause(i, paragraph) >= threshold &&
                    token.text.includes(',') &&
                    currentParagraph.children.length > 3
                  ) {
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
              }
            };
            doc.children.forEach((paragraph) => {
              let minPauseBetweenSentences = initial; // this gets reduced with every additional token
              let currentParagraph = {
                ...paragraph,
                children: [] as { text: string }[],
              };
              paragraph.children.forEach((token, i) => {
                currentParagraph.children.push(JSON.parse(JSON.stringify(token)));
                minPauseBetweenSentences *= decay;
                if (
                  getPause(i, paragraph) >= minPauseBetweenSentences &&
                  containsSentenceEnd(token.text)
                ) {
                  addNewChild(currentParagraph);
                  minPauseBetweenSentences = initial;
                  currentParagraph = {
                    ...paragraph,
                    children: [],
                  };
                }
              });
              if (currentParagraph.children.length > 0) {
                addNewChild(currentParagraph);
              }
            });
            doc.children = newChildren;
          });
        }}
      >
        Smart Reflow ✨
      </MenuItemButton>
    </Popup>
  );
}
