import { platform } from '@tauri-apps/plugin-os';

export function fileExplorerName() {
  switch (platform()) {
    case 'macos':
      return 'Finder';
    case 'windows':
      return 'Explorer';
    default:
      return 'File Explorer';
  }
}
