import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUT_GROUPS, findShortcuts, opensShortcuts } from '../src/services/shortcuts.ts';

const count = (groups: ReturnType<typeof findShortcuts>) => groups.reduce((total, group) => total + group.shortcuts.length, 0);

test('every shortcut says what it does and how, once', () => {
  const seen = new Set<string>();
  for (const group of SHORTCUT_GROUPS) for (const shortcut of group.shortcuts) {
    assert.ok(shortcut.keys.length > 0 && shortcut.keys.every(key => key.trim()), shortcut.does);
    assert.ok(shortcut.does.trim().length > 3);
    const id = `${group.title}:${shortcut.keys.join('|')}:${shortcut.does}`;
    assert.ok(!seen.has(id), id);
    seen.add(id);
    for (const combination of shortcut.keys) assert.ok(!/\+\S|\S\+/.test(combination.replace(/^\+$/, '')), `keys in a combination are spaced: ${combination}`);
  }
});

test('a search keeps the shortcuts every word is found in, by what they do, their keys or their group', () => {
  assert.equal(count(findShortcuts('')), count(SHORTCUT_GROUPS));
  assert.equal(count(findShortcuts('   ')), count(SHORTCUT_GROUPS));
  const undo = findShortcuts('undo');
  assert.deepEqual(undo.flatMap(group => group.shortcuts.map(shortcut => shortcut.does)), ['Undo']);
  assert.deepEqual(findShortcuts('ctrl y').flatMap(group => group.shortcuts.map(shortcut => shortcut.does)), ['Redo'], 'by its keys');
  assert.ok(count(findShortcuts('TEMPO')) >= 1, 'in any case');
  assert.ok(findShortcuts('automation').some(group => group.title === 'Automation'), 'by its group');
  assert.equal(count(findShortcuts('undo tempo')), 0, 'every word must be found');
  assert.ok(count(findShortcuts('?')) >= 1, 'the key that opens the list');
});

test('Shift + ? opens the list anywhere but where it would be typed', () => {
  const key = (props: Partial<KeyboardEvent> = {}) => ({ key: '?', ctrlKey: false, metaKey: false, altKey: false, ...props });
  const at = (selector: string | null) => ({ closest: (query: string) => (selector && query.split(', ').includes(selector) ? {} : null) }) as unknown as EventTarget;
  assert.equal(opensShortcuts(key(), at(null)), true);
  assert.equal(opensShortcuts(key(), null), true);
  for (const field of ['input', 'textarea', 'select', '[contenteditable="true"]']) assert.equal(opensShortcuts(key(), at(field)), false, field);
  assert.equal(opensShortcuts(key({ ctrlKey: true }), at(null)), false);
  assert.equal(opensShortcuts(key({ altKey: true }), at(null)), false);
  assert.equal(opensShortcuts(key({ key: '/' }), at(null)), false);
});
