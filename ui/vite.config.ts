import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import path from 'path';

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

export default defineConfig({
  base: '/discobot/',
  plugins: [audioWorklet(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@discobot/engine': engineSource,
    },
  },
});
