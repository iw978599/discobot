import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { isAudioFile } from '../src/services/sampleStore.ts';
import type { DrumState, Pattern } from '../src/types.ts';

// @tonejs/midi is CommonJS; loading the importer through require gives Node the same named exports Vite sees.
const { importMidiFile } = createRequire(import.meta.url)('../src/utils/midiImport.ts') as typeof import('../src/utils/midiImport.ts');

function drumState(): DrumState {
  return Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), stepVelocities: Array(16).fill(1), muted: false, solo: false,
    settings: { volume: 1, tone: .5, extra: .5 },
  }])) as DrumState;
}

function exportAndImport(steps: Pattern['steps'], drums: DrumState, drumSwing = 0) {
  const bytes = createMidiFile({
    tempo: 133, drumState: drums, drumSwing, drumMasterVolume: 1,
    synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 133, steps } }],
  });
  return importMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

const activeSteps = (steps: boolean[]) => steps.flatMap((active, index) => active ? [index] : []);

test('an exported arrangement imports back onto the same synth steps and drum grid', () => {
  const steps: Pattern['steps'] = Array.from({ length: 16 }, () => ({ active: false, velocity: .7 }));
  steps[0] = { active: true, note: 'C4', velocity: 1 };
  steps[6] = { active: true, note: 'G#3', velocity: .5 };
  const drums = drumState();
  [0, 4, 8, 12].forEach(step => { drums.kick.steps[step] = true; });
  drums.kick.stepVelocities![4] = .5;
  drums.clap.steps[15] = true;

  const result = exportAndImport(steps, drums);
  assert.equal(result.detectedTempo, 133);
  const lead = result.tracks.find(track => track.pattern)!;
  assert.equal(lead.pattern!.steps.length, 16);
  assert.equal(lead.pattern!.steps[0].note, 'C4');
  assert.equal(lead.pattern!.steps[6].note, 'G#3');
  assert.ok(Math.abs(lead.pattern!.steps[6].velocity - .5) < .01);
  assert.equal(lead.pattern!.steps.filter(step => step.active).length, 2);

  const kit = result.tracks.find(track => track.drums)!.drums!;
  assert.deepEqual(activeSteps(kit.kick.steps), [0, 4, 8, 12]);
  assert.deepEqual(activeSteps(kit.clap.steps), [15]);
  assert.ok(Math.abs(kit.kick.stepVelocities[4] - .5) < .01);
  assert.equal(activeSteps(kit.snare.steps).length, 0);
});

test('drums stay on the sixteenth grid when a synth lane is 32 steps, and swing does not move hits', () => {
  const steps: Pattern['steps'] = Array.from({ length: 32 }, () => ({ active: false, velocity: .7 }));
  steps[3] = { active: true, note: 'A2', velocity: .8 };
  const drums = drumState();
  [1, 3, 9].forEach(step => { drums.closedHH.steps[step] = true; });
  drums.kick.steps[8] = true;

  const result = exportAndImport(steps, drums, .6);
  const lead = result.tracks.find(track => track.pattern)!;
  assert.equal(lead.pattern!.steps.length, 32);
  assert.equal(lead.pattern!.steps[3].note, 'A2');
  assert.equal(result.detectedStepCount, 32);

  const kit = result.tracks.find(track => track.drums)!.drums!;
  for (const instrument of DRUM_INSTRUMENTS) {
    assert.equal(kit[instrument].steps.length, 16);
    assert.equal(kit[instrument].stepVelocities.length, 16);
  }
  assert.deepEqual(activeSteps(kit.closedHH.steps), [1, 3, 9]);
  assert.deepEqual(activeSteps(kit.kick.steps), [8]);
});

test('sample import accepts audio by type or extension and rejects everything else', () => {
  assert.equal(isAudioFile({ name: 'kick.wav', type: 'audio/wav' }), true);
  assert.equal(isAudioFile({ name: 'voice-memo', type: 'audio/webm' }), true);
  assert.equal(isAudioFile({ name: 'LOOP.FLAC', type: '' }), true);
  assert.equal(isAudioFile({ name: 'notes.txt', type: 'text/plain' }), false);
  assert.equal(isAudioFile({ name: 'wav', type: '' }), false);
  assert.equal(isAudioFile({ name: 'archive.wav.zip', type: 'application/zip' }), false);
});

test('a MIDI file longer than one bar imports at its own length, lanes and drums together', async () => {
  const { sceneAsBars } = await import('../src/services/patternLength.ts');
  const { barsFor } = createRequire(import.meta.url)('../src/utils/midiImport.ts') as typeof import('../src/utils/midiImport.ts');
  const empty = (): Pattern['steps'] => Array.from({ length: 16 }, () => ({ active: false, velocity: .7 }));
  // Three bars of music: a note in the first and third bars, a kick in the second.
  const bars = [0, 1, 2].map(bar => {
    const steps = empty(), drums = drumState();
    if (bar !== 1) steps[bar === 0 ? 0 : 4] = { active: true, note: bar === 0 ? 'C3' : 'G3', velocity: .8 };
    if (bar === 1) drums.kick.steps[8] = true;
    return { name: 'Part', lanes: { 1: steps }, drumState: drums };
  });
  const bytes = createMidiFile({
    tempo: 100, drumState: drumState(), drumSwing: 0, drumMasterVolume: 1, bars,
    synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 100, steps: empty() } }],
  });
  const result = importMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.deepEqual([result.bars, result.truncated, result.detectedStepCount], [4, false, 16], 'three bars need a four-bar pattern');
  const lane = result.tracks.find(track => track.pattern)!.pattern!;
  assert.deepEqual([lane.steps.length, lane.bars], [64, 4]);
  assert.deepEqual(lane.steps.flatMap((step, index) => step.active ? [[index, step.note]] : []), [[0, 'C3'], [36, 'G3']]);
  const drums = result.tracks.find(track => track.drums)!.drums!;
  assert.equal(drums.kick.steps.length, 64);
  assert.deepEqual(activeSteps(drums.kick.steps), [24]);
  assert.equal(sceneAsBars({ id: 's', name: 's', lanes: { 1: lane.steps }, laneBars: { 1: 4 }, drums: drums as never }).length, 4);

  assert.deepEqual(barsFor(0, 480), { bars: 1, truncated: false });
  assert.deepEqual(barsFor(480 * 4 - 1, 480), { bars: 1, truncated: false });
  assert.deepEqual(barsFor(480 * 4, 480), { bars: 2, truncated: false }, 'a note on the next bar line needs the next bar');
  assert.deepEqual(barsFor(480 * 4 * 4, 480), { bars: 8, truncated: false });
  assert.deepEqual(barsFor(480 * 4 * 8, 480), { bars: 8, truncated: true }, 'anything past eight bars is left out, and said so');
});

test('the sequencer sends notes, clock, start and stop to a MIDI output', async () => {
  const { createMidiOut, CLOCKS_PER_TICK } = await import('../src/services/midiOutput.ts');
  const sent: Array<[number[], number | undefined]> = [];
  const port = { id: 'a', send: (data: number[], at?: number) => { sent.push([data, at]); } };
  const out = createMidiOut();
  out.note(1, 60, 1, 0, 10);
  out.tick(0, 30, true);
  assert.deepEqual(sent, [], 'with no output chosen nothing is sent');

  out.setPort(port);
  out.note(2, 60, 0.5, 1000, 1250);
  out.note(10, 36, 9, 1000, 1000);
  assert.deepEqual(sent, [
    [[0x91, 60, 64], 1000], [[0x81, 60, 0], 1250],
    [[0x99, 36, 127], 1000], [[0x89, 36, 0], 1001],
  ], 'a note is an on and an off at their times, never a zero-length one');
  sent.length = 0;
  for (const bad of [[0, 60], [17, 60], [1, -1], [1, 128], [1, 60.5]]) out.note(bad[0], bad[1], 1, 0, 10);
  out.note(1, 60, 1, NaN, 10);
  assert.deepEqual(sent, [], 'anything that is not a MIDI note is dropped');

  out.tick(2000, 30, true);
  assert.deepEqual(sent, [], 'clock is off until it is asked for');
  out.configure({ clock: true });
  out.tick(2000, 30, true);
  out.tick(2030, 30, false);
  assert.deepEqual(sent.map(([data]) => data[0]), [0xfa, ...Array(CLOCKS_PER_TICK * 2).fill(0xf8)], 'start, then 24 pulses to a quarter note');
  assert.deepEqual(sent.slice(1, 4).map(([, at]) => at), [2000, 2010, 2020]);

  sent.length = 0;
  out.stop();
  assert.deepEqual(sent.map(([data]) => data), [[0xb1, 123, 0], [0xb9, 123, 0], [0xfc]], 'stop silences the channels used and stops the clock');
  sent.length = 0;
  out.stop();
  assert.deepEqual(sent, [], 'and is only sent once');

  out.configure({ notes: false });
  out.note(1, 60, 1, 0, 10);
  assert.deepEqual(sent, []);
  out.setPort({ id: 'broken', send: () => { throw new Error('unplugged'); } });
  out.configure({ notes: true });
  assert.doesNotThrow(() => { out.note(1, 60, 1, 0, 10); out.tick(0, 30, true); out.stop(); });
});
