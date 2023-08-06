// this file contains a hack to revive slate when it breaks because our other hacks kill it.
// se transcription_editor.tsx for how its used

import React, { ReactNode } from 'react';

export const NeedsFullRender = React.createContext(false);

export class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: false };
  }

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      setTimeout(() => {
        this.setState({ error: false });
      }, 0);
    }
    return (
      <NeedsFullRender.Provider value={this.state.error}>
        {this.props.children}
      </NeedsFullRender.Provider>
    );
  }
}
