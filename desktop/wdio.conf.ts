import path from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.e2e.ts'],
  maxInstances: 1,

  // Tauri service configuration
  services: [['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/debug/transcribee-desktop', // Adjust for your OS/app name
    driverProvider: 'embedded',  // Use embedded WebDriver (recommended, no external drivers needed)
  }]],

  // Capabilities
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      appBinaryPath: './src-tauri/target/debug/transcribee-desktop',
    },
  }],

  // ensure the rust project is built since we expect this binary to exist for the webdriver sessions
  onPrepare: () => {
    spawnSync("npm", ["run", "tauri", "build", "--", "--debug", "--no-bundle"], {
      cwd: path.resolve(__dirname),
      stdio: "inherit",
      shell: true,
    });
  },


  // Logging
  logLevel: 'info',
  bail: 0,
  baseUrl: 'http://localhost:4444',
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  // Test configuration
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
};
