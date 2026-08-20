import { attachConsole, info, warn, debug, error, trace } from '@tauri-apps/plugin-log';

function forwardConsole(
  fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
  logger: (message: string) => Promise<void>
) {
  const original = console[fnName];
  console[fnName] = (message) => {
    original(message);
    logger(message);
  };
}

forwardConsole('log', trace);
forwardConsole('debug', debug);
forwardConsole('info', info);
forwardConsole('warn', warn);
forwardConsole('error', error);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';

window.addEventListener('error', e => {
  console.log("error", e)
  error(e.message)
})
window.addEventListener('unhandledrejection', e => {
  error("Unhandled promise rejection:", e.reason)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
