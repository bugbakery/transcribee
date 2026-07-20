import { defineConfig } from "vite";
import wasm from 'vite-plugin-wasm';
import react from "@vitejs/plugin-react";
import ui_common_pkg from '../ui-common/package.json'

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), wasm()],


  // ui-common brings its own node_modules that also contains its peerDependencies
  // this is needed for not duplicating them (and e.g. breaking react)
  resolve: {
    dedupe: Object.keys(ui_common_pkg.peerDependencies)
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
