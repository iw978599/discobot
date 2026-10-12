import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { saveLabel } from '../src/services/saveState.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState } from '../src/types.ts';

const base = { save: 'saved', signedIn: false, inAccount: false, accountCurrent: false, browserOnly: false } as const;

test('the label says only what the app knows', () => {
  assert.equal(saveLabel({ ...base, save: 'paused' }).short, 'Not saving');
  assert.equal(saveLabel({ ...base, save: 'failed' }).short, 'Not saved');
  assert.equal(saveLabel({ ...base, save: 'saving' }).short, 'Saving…');
  assert.equal(saveLabel(base).short, 'Saved');
  assert.equal(saveLabel({ ...base, signedIn: true, inAccount: true, accountCurrent: true }).short, 'In account');
  assert.equal(saveLabel({ ...base, signedIn: true, browserOnly: true }).short, 'Browser only');
  // In the account's list, but the last upload may not hold the latest edit: only "Saved".
  assert.equal(saveLabel({ ...base, signedIn: true, inAccount: true }).short, 'Saved');
  // Signed out, nothing is ever called the account's.
  assert.equal(saveLabel({ ...base, inAccount: true, accountCurrent: true }).short, 'Saved');
  // Pending edits and another tab win over where the project lives.
  assert.equal(saveLabel({ ...base, save: 'saving', signedIn: true, inAccount: true, accountCurrent: true }).short, 'Saving…');
});

test('the service reports an edit waiting, its write, a refused write and another tab', () => {
  const storage = new Map<string, string>();
  let refuse = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (refuse) throw new Error('full'); storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(),
    drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false }])) as DrumState,
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 },
    effectsLoop: {
      enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
      phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
      delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
    },
  });
  service.flush();
  const seen: string[] = [];
  service.subscribeSaveState(() => seen.push(service.saveState()));
  assert.equal(service.saveState(), 'saved');
  service.setTempo(130);
  assert.equal(service.saveState(), 'saving');
  service.flush();
  assert.equal(service.saveState(), 'saved');
  refuse = true;
  service.setTempo(131);
  service.flush();
  assert.equal(service.saveState(), 'failed');
  refuse = false;
  service.flush();
  assert.equal(service.saveState(), 'saved');
  assert.ok(seen.includes('saving') && seen.includes('failed'));
});
