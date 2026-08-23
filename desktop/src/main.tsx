import { info, warn, debug, error, attachLogger, LogLevel } from '@tauri-apps/plugin-log';

// forwar rust logging -> js console
const logMapping = {
  [LogLevel.Trace]: console.debug,
  [LogLevel.Debug]: console.debug,
  [LogLevel.Info]: console.log,
  [LogLevel.Warn]: console.warn,
  [LogLevel.Error]: console.error,
};
attachLogger((payload) => {
  const logger = logMapping[payload.level];
  if (!payload.message.startsWith('[webview')) {
    logger(payload.message);
  }
});

// forward js console -> rust logging
function forwardConsole(
  fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
  logger: (message: string) => Promise<void>,
) {
  const original = console[fnName];
  console[fnName] = (...args) => {
    original(...args);
    let msg = '';
    for (const arg of args) {
      if (msg != '') {
        msg += ' ';
      }
      if (typeof arg == 'string') {
        msg += arg;
      } else {
        const json = JSON.stringify(arg);
        if (json) {
          msg += json;
        } else {
          msg += arg.toString();
        }
      }
    }
    for (const line of msg.split('\n')) {
      logger(line);
    }
  };
}
forwardConsole('debug', debug);
forwardConsole('info', info);
forwardConsole('log', info);
forwardConsole('warn', warn);
forwardConsole('error', error);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';

window.addEventListener('error', (e) => {
  console.error(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason.message);
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
