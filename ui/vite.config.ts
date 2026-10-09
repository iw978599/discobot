import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';

const engineSource = path.resolve(__dirname, '../engine/src');

// An AudioWorklet module must be one self-contained script, so it is bundled separately
// into public/ where both the dev server and the production build serve it.
function audioWorklet(): Plugin {
  const bundle = () => build({
    entryPoints: [path.resolve(__dirname, 'src/audio/worklet.ts')],
    outfile: path.resolve(__dirname, 'public/audio-worklet.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    logLevel: 'warning',
  });
  return {
    name: 'discobot-audio-worklet',
    buildStart: async () => { await bundle(); },
    configureServer(server) {
      server.watcher.add(engineSource);
      server.watcher.on('change', async (file) => {
        const changed = path.resolve(file);
        if (!changed.startsWith(engineSource) && !changed.endsWith(path.join('audio', 'worklet.ts'))) return;
        await bundle();
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

function listFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? listFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
  ));
}

// Emits sw.js with the list of files that make up this build, so the app can be cached
// in full on first visit and opened offline afterwards.
function serviceWorker(): Plugin {
  const publicDirectory = path.resolve(__dirname, 'public');
  return {
    name: 'discobot-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files = new Set(['./']);
      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName.endsWith('.map') || fileName === 'index.html') continue;
        files.add(fileName);
        hash.update(fileName).update(output.type === 'chunk' ? output.code : output.source);
      }
      for (const fileName of listFiles(publicDirectory)) {
        files.add(fileName);
        hash.update(fileName).update(readFileSync(path.join(publicDirectory, fileName)));
      }
      const source = readFileSync(path.resolve(__dirname, 'pwa/service-worker.js'), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify([...files].sort()));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: '/discobot/',
  plugins: [audioWorklet(), react(), serviceWorker()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@discobot/engine': engineSource,
    },
  },
});
