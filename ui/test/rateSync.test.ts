import test from 'node:test';
import assert from 'node:assert/strict';
import { RATE_SYNCS, createDefaultSynthParameters, syncedRateHz, toVoiceParams } from '@discobot/engine';
import { RATE_SYNC_LABELS, rateHz, storedRateSync } from '../src/services/rateSync.ts';
import { sanitizeEffects, sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const loop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: true, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};

test('a synced rate comes round once each note value, and follows the tempo', () => {
  // At 120 a beat is half a second.
  assert.equal(syncedRateHz('1/4', 120), 2);
  assert.equal(syncedRateHz('1/16', 120), 8);
  assert.equal(syncedRateHz('1bar', 120), 0.5);
  assert.equal(syncedRateHz('8bar', 120), 0.0625);
  assert.equal(syncedRateHz('1/4', 60), 1, 'half the tempo, half the rate');
  for (const none of ['off', undefined, null, '', '1/3', 4, {}]) assert.equal(syncedRateHz(none, 120), null);
  // Every value the menus offer has a name and, apart from Free, a rate; slower values come first.
  const rates = RATE_SYNCS.filter(value => value !== 'off').map(value => syncedRateHz(value, 120)!);
  assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
  assert.ok(RATE_SYNCS.every(value => RATE_SYNC_LABELS[value]));
  assert.equal(RATE_SYNC_LABELS.off, 'Free');

  assert.equal(rateHz({ rate: 3 }, 120), 3, 'free, an effect keeps its own rate');
  assert.equal(rateHz({ rate: 3, sync: 'off' }, 120), 3);
  assert.equal(rateHz({ rate: 3, sync: '1/8' }, 120), 4);
  assert.equal(rateHz({ rate: 3, sync: '1/8' }, 90), 3);
  assert.equal(rateHz(undefined, 120, 0.6), 0.6);
});

test('a stored sync is one of the note values or nothing, and effects saved before it are as they were', () => {
  assert.equal(storedRateSync('1/4'), '1/4');
  for (const none of ['off', 'fast', '', 3, null, undefined]) assert.equal(storedRateSync(none), undefined);
  assert.deepEqual(sanitizeEffects(structuredClone(loop), loop), loop, 'nothing is added to an older project');
  const synced = sanitizeEffects({ ...loop, phaser: { ...loop.phaser, sync: '1bar' }, chorus: { enabled: true, rate: 1, depth: .5, mix: .5, sync: '1/2' } }, loop);
  assert.equal(synced.phaser.sync, '1bar');
  assert.equal(synced.chorus!.sync, '1/2');
  // Off is stored as nothing, and so is anything that is not a note value.
  for (const none of ['off', 'whenever', 12]) {
    const cleared = sanitizeEffects({ ...loop, phaser: { ...loop.phaser, sync: none }, chorus: { enabled: true, rate: 1, depth: .5, mix: .5, sync: none } }, loop);
    assert.equal('sync' in cleared.phaser, false);
    assert.equal('sync' in cleared.chorus!, false);
  }
});

test('a sequence of waves can step in time, and the note value wins over its own speed', () => {
  const defaults = createDefaultSynthParameters();
  const sound = (sample: Record<string, unknown>) => sanitizeSynthParams({ ...defaults, engine: 'sample', sample: { root: 60, loop: false, wave: 'seq-fm', scan: 3, fade: 1, ...sample } }, defaults);
  assert.equal(toVoiceParams(sound({}), 120).sampleScan, 3);
  assert.equal(toVoiceParams(sound({ sync: '1/16' }), 120).sampleScan, 8, 'a wave each sixteenth');
  assert.equal(toVoiceParams(sound({ sync: '1/16' }), 60).sampleScan, 4);
  assert.equal(toVoiceParams(sound({ sync: '1bar' }), 120).sampleScan, 0.5);
  assert.equal('sync' in sound({ sync: 'off' }).sample!, false);
  assert.equal('sync' in sound({ sync: 'sometimes' }).sample!, false);
  assert.equal(sound({ sync: '1/8' }).sample!.scan, 3, 'its own speed is kept for when sync is turned off');
});

test('the store keeps a sync, gives it up when it is set to Free, and a project file carries it', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(),
    drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
      steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
    }])) as DrumState,
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0, chorus: 0 }, returnLevel: .7 },
    effectsLoop: loop,
  });
  assert.equal('sync' in service.snapshot().effectsLoop.phaser, false);
  service.setEffectsLoop({ phaser: { ...loop.phaser, sync: '1/4' }, chorus: { enabled: true, rate: 0.8, depth: 0.4, mix: 0.9, sync: '2bar' } });
  assert.equal(service.snapshot().effectsLoop.phaser.sync, '1/4');
  assert.equal(service.snapshot().effectsLoop.chorus!.sync, '2bar');

  // Saved and opened again, synced, and not reported as damaged.
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const imported = await service.importProject(file);
  assert.deepEqual([imported.ok, imported.ok && imported.repaired], [true, false]);
  assert.equal(service.snapshot().effectsLoop.phaser.sync, '1/4');
  assert.equal(service.snapshot().effectsLoop.chorus!.sync, '2bar');

  // Free is sent as 'off', which the store's merge would otherwise keep the old value over.
  service.setEffectsLoop({ phaser: { ...service.snapshot().effectsLoop.phaser, sync: 'off' }, chorus: { ...service.snapshot().effectsLoop.chorus!, sync: 'off' } });
  assert.equal('sync' in service.snapshot().effectsLoop.phaser, false);
  assert.equal('sync' in service.snapshot().effectsLoop.chorus!, false);
});
