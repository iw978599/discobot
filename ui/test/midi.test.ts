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
