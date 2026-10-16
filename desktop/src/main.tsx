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

function prepareArg(arg: unknown) {
  let asString = '';

  if (typeof arg == 'string') {
    asString = arg;
  } else {
    const json = JSON.stringify(arg);
    if (json) {
      asString = json;
    } else {
      asString = '' + arg;
    }
  }

  const MAX_ARG_LENGTH = 10_000;
  // sending very long strings stalls the whole application
  if (asString.length > MAX_ARG_LENGTH) {
    return asString.substring(0, MAX_ARG_LENGTH) + '… (truncated)';
  } else {
    return asString;
  }
}

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
      msg += prepareArg(arg);
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
