// A project store on its own, and one edit to it with everything the edit did. Shared by the
// tests that pin the store's behaviour: storeEdits.test.ts and storeOps.test.ts.
import assert from 'node:assert/strict';
import { LocalProjectService } from '../../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../../engine/src/synth/voiceParams.ts';
import type { Applied } from '../../src/services/projectOps.ts';
import type { DrumState, EffectsLoopState } from '../../src/types.ts';

export const storage = new Map<string, string>();
export const defaults = () => ({
  synthParams: createDefaultSynthParameters(),
  drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
  }])) as DrumState,
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 },
  effectsLoop: {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  } satisfies EffectsLoopState,
});
export function setup() {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize(defaults());
  return service;
}

// What an edit that is meant to be accepted answered; fails the test if it was refused.
export const ok = (result: Applied<unknown>): any => {
  assert.ok(result.ok, `expected the edit to be accepted: ${result.ok ? '' : result.error}`);
  return result.value;
};
// The status a route would have answered: 200 for an accepted edit.
export const statusOf = (result: Applied<unknown>) => (result.ok ? 200 : result.status);

export type Message = { type: string; data: any };
export type Result = { status: number; data: any; events: Message[]; saved: boolean };

// One edit, with everything it did: `run` calls `apply` or a typed helper. A save is "scheduled"
// when the edit called persist(): nothing is waiting before it, so flush() afterwards writes exactly
// when it did. Everything it reports had happened by the time `run` returned.
export function applied<V>(service: LocalProjectService, run: (service: LocalProjectService) => Applied<V>): Result {
  service.flush();
  const events: Message[] = [];
  let listening = false, writes = 0;
  const stopEvents = service.subscribe(message => { if (listening) events.push(message); });
  const stopWrites = service.subscribeWrites(() => { writes++; });
  listening = true;
  const result = run(service);
  assert.equal(writes, 0, 'nothing is written during the operation itself');
  service.flush();
  stopEvents();
  stopWrites();
  assert.ok(writes <= 1);
  return result.ok
    ? { status: 200, data: result.value, events, saved: writes === 1 }
    : { status: result.status, data: { error: result.error }, events, saved: writes === 1 };
}

// A project in a form two separate stores can be compared by: without the times, and with each
// random id replaced by its place among the ids.
export function comparable(project: unknown) {
  const ids = new Map<string, string>();
  const text = JSON.stringify(project, (key, value) => (key === 'createdAt' || key === 'updatedAt' ? undefined : value))
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, id => {
      if (!ids.has(id)) ids.set(id, `id-${ids.size + 1}`);
      return ids.get(id)!;
    });
  return JSON.parse(text);
}
