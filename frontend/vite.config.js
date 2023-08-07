import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { favicons } from "favicons";
import topLevelAwait from 'vite-plugin-top-level-await';
import { execSync } from 'child_process';
import fs from 'fs';

function gitVersionPlugin() {
  const virtualModuleId = 'virtual:git-version';

  return {
    name: 'git-version', // required, will show up in warnings and errors
    resolveId(id) {
      if (id === virtualModuleId) {
        return virtualModuleId;
      }
    },
    load(id) {
      function git(command) {
        let stdout = null;
        try {
          stdout = execSync(`git ${command}`).toString().trim();
        } catch (error) {
          console.error(error);
        }
        return stdout;
      }

      function commitInfo(ref) {
        return {
          hash: git(`rev-parse ${ref}`),
          date: git(`show -s --format=%cI ${ref}`),
          countSinceStart: parseInt(git(`rev-list --count ${ref}`)),
        };
      }

      if (id === virtualModuleId) {
        const lastCommitOnMain = git("merge-base origin/main HEAD");
        const json = JSON.stringify({
          diffShort: git('diff --shortstat HEAD'),
          lastCommit: commitInfo('HEAD'),
          lastCommitOnMain: commitInfo(lastCommitOnMain),
          branch: git('rev-parse --abbrev-ref HEAD'),
          date: new Date().toISOString(),
        });
        return `
          const version = ${json};
          export default version;
        `;
      }
    },
  };
}

function faviconPlugin(originalPath) {
  const files = {};
  function addFiles(ctx, fileName, source) {
    ctx.emitFile({ type: 'asset', fileName, source });
    files[`/${fileName}`] = source;
  }

  return {
    name: 'favicon-plugin', // required, will show up in warnings and errors
    async buildStart() {
      const response = await favicons(originalPath, {
        icons: {
          android: false,
          appleIcon: false,
          appleStartup: false,
          windows: false,
          yandex: false,

          favicons: true,
        },
      });

      addFiles(this, "favicon.svg", fs.readFileSync(originalPath))
      response.images.forEach(img => {
        addFiles(this, img.file, img.contents)
      })
    },
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.originalUrl in files) {
            res.end(files[req.originalUrl]);
          }
          next()
        })
      }
    },
  };
}

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/api/v1/documents/sync': { target: 'http://127.0.0.1:8000', ws: true },
      '/media': 'http://127.0.0.1:8000',
    },
  },
  plugins: [
    topLevelAwait(),
    wasm(),
    gitVersionPlugin(),
    faviconPlugin("../doc/transcribee-logo.svg"),
  ],

  // This is only necessary if you are using `SharedWorker` or `WebWorker`, as
  // documented in https://vitejs.dev/guide/features.html#import-with-constructors
  worker: {
    format: 'es',
    plugins: [topLevelAwait(), wasm()],
  },

  optimizeDeps: {
    // This is necessary because otherwise `vite dev` includes two separate
    // versions of the JS wrapper. This causes problems because the JS
    // wrapper has a module level variable to track JS side heap
    // allocations, initializing this twice causes horrible breakage
    exclude: ['@automerge/automerge-wasm'],
  },
});
