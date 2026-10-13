import test from 'node:test';
import assert from 'node:assert/strict';
import { mixerChannels, panText, parsePan, parsePercent, percentText, sameMixer, type MixerSource } from '../src/services/mixerChannels.ts';
import { DRUM_INSTRUMENTS, DRUM_NAMES, DRUM_ROWS } from '../src/services/drumKits.ts';
import { DRUM_NAMES as TARGET_NAMES } from '../src/services/paramTargets.ts';
import type { DrumState } from '../src/types.ts';

const kit = () => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
}])) as DrumState;

const source = (more: Partial<MixerSource> = {}): MixerSource => ({
  synths: [
    { id: 2, synthModelId: 'generic', synthParams: { gain: 1.5, pan: -0.25 }, muted: true },
    { id: 1, synthModelId: 'generic', synthParams: { gain: 0.8, pan: 0 }, solo: true },
  ],
  drumState: kit(),
  drumMasterVolume: 0.9,
  guests: [],
  effectsLoop: { returns: { synth: 0.85, drums: 0.7 } },
  browserVolume: 1,
  ...more,
});

test('every lane the project has gets a channel, in order, with its own level, pan, mute and solo', () => {
  const { lanes } = mixerChannels(source());
  assert.deepEqual(lanes.map(lane => lane.id), [1, 2]);
  assert.deepEqual(lanes[0], { id: 1, model: lanes[0].model, level: 0.8, pan: 0, muted: false, solo: true });
  assert.deepEqual(lanes[1], { id: 2, model: lanes[1].model, level: 1.5, pan: -0.25, muted: true, solo: false });
  assert.ok(lanes[0].model.length > 0, 'a lane says its model');
  assert.deepEqual(mixerChannels(source({ synths: [] })).lanes, [], 'no lanes, no channels');
  assert.equal(mixerChannels(source({ synths: [{ id: 3, synthModelId: 'generic', synthParams: null }] })).lanes[0].level, 1, 'a lane whose sound has not arrived reads as full');
});

test('each of the eight drums has a channel, in the grid\'s order, and a pan that was never set is the centre', () => {
  const drumState = kit();
  drumState.snare.settings = { ...drumState.snare.settings, volume: 0.68, pan: 0.5 };
  drumState.kick.muted = true;
  drumState.crash.solo = true;
  const { drums, drumMaster } = mixerChannels(source({ drumState }));
  assert.deepEqual(drums.map(drum => drum.id), DRUM_ROWS);
  assert.deepEqual(drums[0], { id: 'kick', volume: 0.5, pan: 0, muted: true, solo: false });
  assert.deepEqual(drums[1], { id: 'snare', volume: 0.68, pan: 0.5, muted: false, solo: false });
  assert.equal(drums[7].solo, true);
  assert.equal(drumMaster, 0.9);
});

test('the grid\'s order holds every drum once, and a drum has one name wherever it is named', () => {
  assert.deepEqual([...DRUM_ROWS].sort(), [...DRUM_INSTRUMENTS].sort());
  assert.equal(TARGET_NAMES, DRUM_NAMES, 'the names a MIDI knob is tied by are the same list, not a copy');
  assert.deepEqual(Object.keys(DRUM_NAMES).sort(), [...DRUM_INSTRUMENTS].sort());
});

test('a guest has a channel with its level and mute, named as its unit is', () => {
  const guests = [
    { id: 'a', url: 'https://example.org/bell/', name: 'Beat Bell', volume: 0.8, muted: false },
    { id: 'b', url: 'https://example.org/other/', name: '', volume: 0.3, muted: true },
  ];
  assert.deepEqual(mixerChannels(source({ guests })).guests, [
    { id: 'a', name: 'Beat Bell', volume: 0.8, muted: false },
    { id: 'b', name: 'https://example.org', volume: 0.3, muted: true },
  ]);
});

test('the returns and the main volume are carried as they are', () => {
  const channels = mixerChannels(source({ browserVolume: 0.4 }));
  assert.deepEqual(channels.returns, { synth: 0.85, drums: 0.7 });
  assert.equal(channels.main, 0.4);
});

test('the mixer is the same until a level it shows changes', () => {
  const before = mixerChannels(source());
  assert.equal(sameMixer(before, before), true);
  assert.equal(sameMixer(before, mixerChannels(source())), true, 'new lanes and drums holding the same levels');
  const stepped = kit();
  stepped.kick.steps[3] = true;
  assert.equal(sameMixer(before, mixerChannels(source({ drumState: stepped }))), true, 'a drum step is not a level');
  const louder = kit();
  louder.kick.settings = { ...louder.kick.settings, volume: 0.51 };
  assert.equal(sameMixer(before, mixerChannels(source({ drumState: louder }))), false);
  assert.equal(sameMixer(before, mixerChannels(source({ browserVolume: 0.99 }))), false);
  assert.equal(sameMixer(before, mixerChannels(source({ drumMasterVolume: 0.5 }))), false);
  assert.equal(sameMixer(before, mixerChannels(source({ effectsLoop: { returns: { synth: 0.85, drums: 0.71 } } }))), false);
  assert.equal(sameMixer(before, mixerChannels(source({ synths: source().synths.map(synth => ({ ...synth, muted: false })) }))), false);
  assert.equal(sameMixer(before, mixerChannels(source({ guests: [{ id: 'a', url: 'https://example.org/', name: 'A', volume: 1, muted: false }] }))), false);
});

test('a pan reads as its own knob reads it: a lane to 100 either side, a drum to 50', () => {
  assert.deepEqual([0, -1, 0.4, -0.26].map(pan => panText(pan, 'lane')), ['C', 'L100', 'R40', 'L26']);
  assert.deepEqual([0, 0.04, -1, 0.5].map(pan => panText(pan, 'drum')), ['C', 'C', 'L50', 'R25']);
  assert.equal(parsePan('c', 'lane'), 0);
  assert.equal(parsePan('L40', 'lane'), -0.4);
  assert.equal(parsePan('R40', 'lane'), 0.4);
  assert.equal(parsePan('l25', 'drum'), -0.5);
  assert.equal(parsePan('50', 'drum'), 1);
  assert.equal(parsePan('left', 'drum'), null);
});

test('a level is read and typed as a percentage', () => {
  assert.equal(percentText(0.685), '69%');
  assert.equal(percentText(2), '200%');
  assert.equal(parsePercent('35%'), 0.35);
  assert.equal(parsePercent(' 120 '), 1.2);
  assert.equal(parsePercent('loud'), null);
});
