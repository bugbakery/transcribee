import { useState } from 'react';
import { useEvent } from './utils/use_event';

declare global {
  interface Window {
    debugMode: () => void;
  }
}

const DEBUG_MODE_CHANGED_EVENT = 'debugModeChanged';
class DebugModeChangedEvent extends CustomEvent<{ enabled: boolean }> {
  constructor(enabled: boolean) {
    super(DEBUG_MODE_CHANGED_EVENT, { detail: { enabled } });
  }
}

const LOCAL_STORAGE_DEBUG_MODE = 'debugMode';

function isDebugMode() {
  return localStorage.getItem(LOCAL_STORAGE_DEBUG_MODE) != null;
}

window.debugMode = () => {
  const enableDebug = !isDebugMode();
  if (enableDebug) {
    localStorage.setItem(LOCAL_STORAGE_DEBUG_MODE, 'true');
  } else {
    localStorage.removeItem(LOCAL_STORAGE_DEBUG_MODE);
  }
  window.dispatchEvent(new DebugModeChangedEvent(enableDebug));
};

export function useDebugMode() {
  const [debugModeEnabled, setDebugModeEnabled] = useState(isDebugMode());

  useEvent<DebugModeChangedEvent>(DEBUG_MODE_CHANGED_EVENT, (e) => {
    setDebugModeEnabled(e.detail.enabled);
  });

  return debugModeEnabled;
}
