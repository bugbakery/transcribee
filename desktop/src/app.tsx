import { Route, Router } from 'wouter';
import { ModalHolder } from 'transcribee-ui-common/components/modal';
import { HomePage } from './pages/home';
import { DocumentPage } from './pages/document';
import { NewTranscriptDialog } from './pages/new_transcript_dialog';
import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

declare global {
  interface Window {
    __SHOW_WINDOW_WHEN_READY__: boolean | undefined;
  }
}

function App() {
  useEffect(() => {
    // this is a workaround to delay showing the window until our app is ready
    if (window.__SHOW_WINDOW_WHEN_READY__) {
      setTimeout(() => {
        getCurrentWebviewWindow().show();
      }, 0);
    }
  }, []);

  return (
    <Router>
      <ModalHolder />
      <Route path="/" component={HomePage} />
      <Route path="/document/*" component={DocumentPage} />
      <Route path="/new_transcript" component={NewTranscriptDialog} />
    </Router>
  );
}

export default App;
