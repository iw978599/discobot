import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_KINDS, PRESET_KIND_LABELS, USER_PRESET_GROUP, groupPresets, type PresetKind } from '../src/services/presetKinds.ts';

const built = (name: string, kind: PresetKind) => ({ name, kind, builtIn: true });

test('presets are grouped by kind in the agreed order, each group in the order given', () => {
  const groups = groupPresets([built('Warm', 'pad'), built('Sub', 'bass'), built('Glass', 'pad'), built('Saw', 'lead')]);
  assert.deepEqual(groups.map(group => [group.label, group.presets.map(preset => preset.name)]), [
    ['Bass', ['Sub']], ['Lead', ['Saw']], ['Pad', ['Warm', 'Glass']],
  ]);
});

test('a kind with no presets has no group, and the person\'s own presets come last in a group of their own', () => {
  const groups = groupPresets([{ name: 'Mine' }, built('Sub', 'bass'), { name: 'Imported', kind: 'lead' as PresetKind }]);
  assert.deepEqual(groups.map(group => group.label), ['Bass', USER_PRESET_GROUP]);
  assert.deepEqual(groups[1].presets.map(preset => preset.name), ['Mine', 'Imported']);
});

test('every kind has a name for its group', () => {
  for (const kind of PRESET_KINDS) assert.ok(PRESET_KIND_LABELS[kind].length > 0);
});
