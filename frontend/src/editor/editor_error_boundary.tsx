// this file contains a hack to save slate when it breaks because our other hacks kill it.
// Slate raises exceptions when handling selections. We just ignore these errors and deselct

import React, { ReactNode } from 'react';
import { Editor, Transforms } from 'slate';

export class ErrorBoundary extends React.Component<{ children: ReactNode; editor: Editor }> {
  constructor(props: { children: ReactNode; editor: Editor }) {
    super(props);
  }

  componentDidCatch() {
    Transforms.deselect(this.props.editor);
  }

  render() {
    return this.props.children;
  }
}
