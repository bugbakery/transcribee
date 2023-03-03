import { useEffect, useState } from 'react';

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

  const event = new DebugModeChangedEvent(enableDebug);
  window.dispatchEvent(event);
};

export function useDebugMode() {
  const [debugModeEnabled, setDebugModeEnabled] = useState(isDebugMode());

  useEffect(() => {
    const listener = (e: Event) => {
      const event = e as DebugModeChangedEvent;
      setDebugModeEnabled(event.detail.enabled);
    };

    window.addEventListener(DEBUG_MODE_CHANGED_EVENT, listener);
    () => {
      window.removeEventListener(DEBUG_MODE_CHANGED_EVENT, listener);
    };
  }, []);

  return debugModeEnabled;
}
