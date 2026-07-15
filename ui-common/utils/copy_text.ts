const BLOCK_ELEMENTS = [
  'DIV',
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'LABEL',
  'BUTTON',
];

function isBlockElement(childNode: ChildNode) {
  return childNode instanceof Element && BLOCK_ELEMENTS.includes(childNode.tagName);
}

function collectSelectableTextFromNodes(children: ChildNode[]): string {
  let text = '';

  children.forEach((child) => {
    if (child instanceof Element && child.classList.contains('select-none')) {
      // skip non-selecatble element
      return;
    }

    if (child.childNodes.length > 0) {
      // non-leaf node
      text += collectSelectableTextFromNodes(Array.from(child.childNodes));

      // add new lines if elements are likely displayed as blocks
      if (!text.endsWith('\n') && isBlockElement(child)) {
        text += '\n';
      }
    } else {
      // leaf node
      if (child.textContent !== '\ufeff') {
        // no not add byte order marks
        text += child.textContent ?? '';
      }
    }
  });

  return text;
}

let registered = false;

/**
 * Prevents copying of non-selectable text.
 */
export function registerCopyHandler() {
  if (registered) return;
  registered = true;

  window.addEventListener('copy', (e) => {
    const selection = document.getSelection();
    if (!selection) return;

    let text = '';
    for (let i = 0; i < selection.rangeCount; i++) {
      const children = selection.getRangeAt(i).cloneContents().childNodes;
      text += collectSelectableTextFromNodes(Array.from(children));
    }

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    }
  });
}
