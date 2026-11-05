import test from 'node:test';
import assert from 'node:assert/strict';
import { asLayout, layoutChoice, startLayout, storedLayout } from '../src/services/layoutChoice.ts';

const store = new Map<string, string>();
const root = { dataset: {} as Record<string, string> };
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } },
  document: { documentElement: root },
});

test('only rack and desk are layouts', () => {
  assert.equal(asLayout('rack'), 'rack');
  assert.equal(asLayout('desk'), 'desk');
  for (const bad of ['', 'Desk', 'grid', null, undefined, 3, {}]) assert.equal(asLayout(bad), null);
});

test('the rack is the default and sets nothing on the page', () => {
  store.clear();
  delete root.dataset.layout;
  assert.equal(storedLayout(), 'rack');
  startLayout();
  assert.equal(layoutChoice.get(), 'rack');
  assert.equal(root.dataset.layout, undefined);
});

test('a bad stored value is the rack', () => {
  store.set('discobot_layout_v1', 'grid');
  assert.equal(storedLayout(), 'rack');
});

test('choosing the desk marks the page, keeps the choice and tells listeners; choosing the rack undoes it', () => {
  store.clear();
  startLayout();
  let heard = 0;
  const stop = layoutChoice.subscribe(() => { heard += 1; });
  layoutChoice.set('desk');
  assert.equal(root.dataset.layout, 'desk');
  assert.equal(store.get('discobot_layout_v1'), 'desk');
  assert.equal(heard, 1);
  root.dataset = {};
  startLayout();
  assert.equal(layoutChoice.get(), 'desk', 'read back from storage');
  assert.equal(root.dataset.layout, 'desk');
  layoutChoice.set('rack');
  assert.equal(root.dataset.layout, undefined);
  assert.equal(heard, 2);
  stop();
  layoutChoice.set('desk');
  assert.equal(heard, 2, 'unsubscribed');
});
