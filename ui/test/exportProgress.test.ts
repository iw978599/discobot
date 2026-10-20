// An audio export says how far it has got (roadmap 19): the lanes and the drums are the first half,
// one share each, and the browser's render is the second, in ten. Without anyone asking, the
// render is what it was, with no stops in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '@discobot/engine';
import { createDefaultDrumState } from '../src/studio/studioState.ts';
import { type ExportArrangement, renderArrangement, renderStemsZip } from '../src/services/wavExport.ts';
import type { EffectsLoopState } from '../src/types.ts';

class Param { value = 0; setTargetAtTime() {} setValueAtTime() {} linearRampToValueAtTime() {} }
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  buffer?: unknown; curve?: Float32Array; oversample?: string;
  connect(node: Node) { return node; }
  start() {}
}
// Enough of an offline context to render nothing, which stops where it was asked to and goes on
// only once it is told to.
class Offline {
  static suspends: number[] = [];
  private waiting: Array<{ at: number; resolve: () => void }> = [];
  private resumed: () => void = () => {};
  destination = new Node();
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
  createGain = () => new Node(); createDynamicsCompressor = () => new Node(); createWaveShaper = () => new Node();
  createDelay = () => new Node(); createConvolver = () => new Node(); createBiquadFilter = () => new Node();
  createOscillator = () => new Node(); createChannelMerger = () => new Node(); createBufferSource = () => new Node();
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (channel: number) => data[channel] };
  }
  suspend(at: number) {
    Offline.suspends.push(at);
    return new Promise<void>(resolve => this.waiting.push({ at, resolve }));
  }
  resume() { this.resumed(); return Promise.resolve(); }
  startRendering = async () => {
    for (const stop of [...this.waiting].sort((a, b) => a.at - b.at)) {
      const going = new Promise<void>(resolve => { this.resumed = resolve; });
      stop.resolve();
      await going;
    }
    return this.createBuffer(2, this.length);
  };
}

const effects: EffectsLoopState = {
  enabled: false, returns: { synth: .8, drums: .7 }, drive: { enabled: false, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: false, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: false, decay: 2, mix: .3 },
};
const lane = (id: number) => ({
  id, synthParams: createDefaultSynthParameters(), muted: false, solo: false,
  pattern: { steps: Array.from({ length: 16 }, (_, step) => ({ active: step === 0, note: step === 0 ? 'C3' : null, velocity: 100 })) },
});
const arrangement = (): ExportArrangement => {
  const drumState = createDefaultDrumState();
  drumState.kick.steps[0] = true;
  return {
    tempo: 120, synths: [lane(1), lane(2)], drumState, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0,
    drumFx: { sends: { reverb: 0, delay: 0, drive: 0, phaser: 0 }, returnLevel: 1 }, effectsLoop: effects,
  } as unknown as ExportArrangement;
};

const withOffline = async (run: () => Promise<void>) => {
  const original = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext = Offline as unknown as typeof OfflineAudioContext;
  Offline.suspends = [];
  try { await run(); } finally { globalThis.OfflineAudioContext = original; }
};

test('an export reports each lane and the drums as a share of the first half, then the browser\'s render in ten, ending at 1', async () => {
  await withOffline(async () => {
    const told: number[] = [];
    await renderArrangement(arrangement(), { onProgress: fraction => told.push(fraction) });
    const round = told.map(value => Math.round(value * 1000) / 1000);
    assert.deepEqual(round.slice(0, 3), [0.5 / 3, 1 / 3, 0.5].map(value => Math.round(value * 1000) / 1000), 'two lanes and the drums');
    assert.deepEqual(round.slice(3), [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
    assert.ok(told.every((value, index) => index === 0 || value >= told[index - 1]), 'it never goes back');
    // Each stop is on a whole render quantum.
    assert.ok(Offline.suspends.every(at => Number.isInteger(Math.round(at * 44100) / 128)));
  });
});

test('an export nobody watches is not stopped, and stems report across the whole zip', async () => {
  await withOffline(async () => {
    await renderArrangement(arrangement());
    assert.deepEqual(Offline.suspends, [], 'no stops without a listener');
    const told: Array<[number, number, number]> = [];
    await renderStemsZip(arrangement(), (done, total, fraction) => told.push([done, total, fraction]));
    assert.equal(told[0][1], 3, 'two lanes and the drums, each a file');
    assert.deepEqual(told[0], [0, 3, 0]);
    assert.ok(told.every((entry, index) => index === 0 || entry[2] >= told[index - 1][2]), 'it never goes back');
    assert.ok(Math.abs(told[told.length - 1][2] - 1) < 1e-9, 'and ends at the whole');
    assert.deepEqual([...new Set(told.map(entry => entry[0]))], [0, 1, 2], 'naming each file as it is made');
  });
});
