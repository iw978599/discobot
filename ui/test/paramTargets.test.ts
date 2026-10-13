import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '@discobot/engine';
import { DRUM_PARAMS, FX_PARAMS, LANE_PARAMS, fromUnit, lanePatch, listTargets, parseTarget, targetLabel } from '../src/services/paramTargets.ts';
import { MAX_MIDI_TIES, asMidiTies, storeMidiTies, storedMidiTies, tieFor, withTie, withoutTie } from '../src/services/midiTies.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';

test('every name in the menu means something, and a name that is not one means nothing', () => {
  const groups = listTargets([1, 2, 3]);
  const ids = groups.flatMap(group => group.targets.map(target => target.id));
  assert.equal(new Set(ids).size, ids.length, 'no name twice');
  assert.deepEqual(groups.map(group => group.group), ['The open lane', 'Synth 1', 'Synth 2', 'Synth 3', 'Drums', 'Effects', 'Song']);
  for (const id of ids) {
    const parsed = parseTarget(id);
    assert.ok(parsed, id);
    assert.ok(parsed.range.max > parsed.range.min, id);
    assert.ok(targetLabel(id).length > 2 && !targetLabel(id).includes('does not have'), id);
  }
  for (const bad of ['', 'lane', 'lane:1', 'lane:0:cutoff', 'lane:12:cutoff', 'lane:1:nothing', 'lane:1:cutoff:more', 'drum:cowbell:volume', 'drum:kick:colour', 'fx:delay.nothing', 'fx:delay.feedback:x', 'tempo:1', 7, null, undefined]) {
    assert.equal(parseTarget(bad), null, String(bad));
  }
  assert.equal(targetLabel('lane:open:cutoff'), 'The open lane: Cutoff');
  assert.equal(targetLabel('drum:snare:volume'), 'Snare: Volume');
  assert.equal(targetLabel('nonsense'), 'Something this version does not have');
});

test('a knob\'s travel covers a parameter\'s whole range, evenly by ratio for a frequency or a time', () => {
  const cutoff = LANE_PARAMS.cutoff, level = LANE_PARAMS.level;
  assert.equal(fromUnit(cutoff, 0), 20);
  assert.equal(fromUnit(cutoff, 1), 20000);
  assert.ok(Math.abs(fromUnit(cutoff, 0.5) - Math.sqrt(20 * 20000)) < 0.01, 'half way is the middle by ratio');
  assert.deepEqual([fromUnit(level, 0), fromUnit(level, 0.5), fromUnit(level, 1)], [0, 1, 2]);
  assert.equal(fromUnit(parseTarget('tempo')!.range, 0.5), 120, 'a whole number where the parameter is one');
  // Out of range or nonsense is held to the ends.
  assert.deepEqual([fromUnit(level, -3), fromUnit(level, 9), fromUnit(level, Number.NaN)], [0, 2, 0]);
});

test('setting a lane\'s parameter is a change the store can merge, and what it sets survives the checks on a sound', () => {
  assert.deepEqual(lanePatch('cutoff', 800), { filter: { frequency: 800 } });
  assert.deepEqual(lanePatch('level', 1.5), { gain: 1.5 });
  assert.deepEqual(lanePatch('reverbSend', 0.4), { fxSends: { reverb: 0.4 } });
  assert.equal(lanePatch('macro1', 0.5), null, 'a model\'s knob is not part of the sound: it goes to the model');
  assert.equal(lanePatch('nothing', 1), null);
  // Every lane parameter, at both ends of its travel, is a value the sound's own limits accept.
  const defaults = createDefaultSynthParameters();
  for (const [key, range] of Object.entries(LANE_PARAMS)) {
    if (!range.path) continue;
    for (const unit of [0, 1]) {
      const value = fromUnit(range, unit);
      const merged = structuredClone(defaults) as unknown as Record<string, unknown>;
      let at = merged;
      for (const name of range.path.slice(0, -1)) at = at[name] as Record<string, unknown>;
      at[range.path.at(-1)!] = value;
      let kept: unknown = sanitizeSynthParams(merged, defaults);
      for (const name of range.path) kept = (kept as Record<string, unknown>)[name];
      assert.equal(kept, value, `${key} at ${unit}`);
    }
  }
  assert.ok(Object.keys(DRUM_PARAMS).length >= 4 && Object.keys(FX_PARAMS).length >= 8);
});

test('ties are a knob and a parameter each used once, kept between visits, and anything odd stored is dropped', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  assert.deepEqual(storedMidiTies(), []);
  let ties = withTie([], { channel: 1, controller: 21, target: 'lane:open:cutoff' });
  ties = withTie(ties, { channel: 1, controller: 22, target: 'lane:open:resonance' });
  assert.equal(ties.length, 2);
  assert.equal(tieFor(ties, 1, 21)?.target, 'lane:open:cutoff');
  assert.equal(tieFor(ties, 2, 21), undefined, 'the same number on another channel is another knob');
  // The same knob given another parameter lets the first go; so does the same parameter given another knob.
  ties = withTie(ties, { channel: 1, controller: 21, target: 'fx:delay.mix' });
  assert.deepEqual(ties.map(tie => tie.target).sort(), ['fx:delay.mix', 'lane:open:resonance']);
  ties = withTie(ties, { channel: 1, controller: 30, target: 'fx:delay.mix' });
  assert.equal(tieFor(ties, 1, 21), undefined);
  assert.equal(tieFor(ties, 1, 30)?.target, 'fx:delay.mix');
  storeMidiTies(ties);
  assert.deepEqual(storedMidiTies(), ties);
  assert.deepEqual(withoutTie(ties, 'fx:delay.mix').map(tie => tie.target), ['lane:open:resonance']);

  assert.deepEqual(asMidiTies([
    { channel: 1, controller: 5, target: 'tempo' }, { channel: 1, controller: 5, target: 'drums:master' },
    { channel: 0, controller: 5, target: 'tempo' }, { channel: 1, controller: 128, target: 'tempo' },
    { channel: 1, controller: 6, target: 'lane:1:nothing' }, 'tie', null, { channel: '1', controller: 7, target: 'tempo' },
  ]), [{ channel: 1, controller: 5, target: 'tempo' }]);
  assert.deepEqual(asMidiTies('not a list'), []);
  storage.set('discobot_midi_ties_v1', '{broken');
  assert.deepEqual(storedMidiTies(), []);
  const many = Array.from({ length: 200 }, (_, index) => ({ channel: 1 + (index % 16), controller: index % 128, target: 'tempo' }));
  assert.ok(asMidiTies(many).length <= MAX_MIDI_TIES);
});
