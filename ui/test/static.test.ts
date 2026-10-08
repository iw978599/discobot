import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('only browser-compatible workspaces and dependencies remain', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.deepEqual(manifest.workspaces, ['engine', 'ui']);
  const lock = read('package-lock.json');
  assert.doesNotMatch(lock, /discord\.js|@discordjs\/|node-web-audio-api|"node_modules\/express"|"node_modules\/ws"/);
  assert.equal(existsSync(new URL('bot/package.json', root)), false);
  assert.equal(existsSync(new URL('web/package.json', root)), false);
});

test('project assets and privileged deployment use the correct boundary', () => {
  assert.match(read('ui/vite.config.ts'), /base:\s*'\/discobot\/'/);
  assert.doesNotMatch(read('ui/index.html'), /href="\/vite\.svg"/);
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(pages, /pull_request/);
  assert.match(pages, /path: ui\/dist/);
  assert.match(pages, /pages: write/);
  assert.match(pages, /id-token: write/);
  assert.match(pages, /name: github-pages/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request:/);
  assert.doesNotMatch(ci, /pages: write|id-token: write|pull_request_target/);
});
