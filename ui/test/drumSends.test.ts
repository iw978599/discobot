import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters, type DrumInstrument, type DrumSettings } from '@discobot/engine';
import { DrumCore, type DrumSample } from '../../engine/src/drums/DrumCore.ts';
import { DRUM_INSTRUMENTS, DRUM_KITS } from '../src/services/drumKits.ts';
import { sanitizeDrums } from '../src/services/projectSanitization.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { contentHash } from '../src/services/projectSync.ts';
import { DRUM_PARAMS, fromUnit, parseTarget, targetLabel } from '../src/services/paramTargets.ts';
import { AudioEngine } from '../src/hooks/browserAudio.ts';
import { type ExportArrangement, renderArrangement, renderDrumMixes, renderDrums } from '../src/services/wavExport.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const SR = 44100;
// No humanizing unless a test asks: the drums share one run of small random changes, so taking a
// drum away would otherwise move every other drum's a little.
const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({ volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0, ...patch });
const drums = (patch: Partial<Record<DrumInstrument, Partial<DrumSettings>>> = {}, on: Partial<Record<DrumInstrument, number[]>> = {}): DrumState =>
  Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array.from({ length: 16 }, (_, step) => Boolean(on[instrument]?.includes(step))), muted: false, solo: false, settings: settings(patch[instrument]),
  }])) as DrumState;
const sample: DrumSample = { data: Float32Array.from({ length: 3000 }, (_, i) => Math.sin(i / 9) * (1 - i / 3000)), rate: 32000 };
const cymbal: DrumSample = { data: Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i / 3) * Math.exp(-i / 5000)), rate: 44100 };
type Mix = [Float32Array, Float32Array];
const blank = (frames: number): Mix => [new Float32Array(frames), new Float32Array(frames)];
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const silent = (a: Float32Array) => a.every(value => value === 0);
const energy = (a: Float32Array) => a.reduce((sum, value) => sum + value * value, 0);

// Every drum struck a little apart, each somewhere of its own from side to side, in blocks as the worklet runs them.
function play(kitId: string, patch: (instrument: DrumInstrument) => Partial<DrumSettings>, withSends: boolean, recordings = false, frames = SR) {
  const core = new DrumCore(SR);
  if (recordings) { core.setSample('snare', sample); core.setCymbals({ crash: cymbal }); }
  DRUM_INSTRUMENTS.forEach((instrument, row) => {
    for (const at of [0.01 + row * 0.02, 0.3 + row * 0.011]) {
      core.trigger({ instrument, kitId, velocity: 0.6 + row / 20, time: at, settings: settings({ pan: (row - 3.5) / 4, ...patch(instrument) }) });
    }
  });
  const kit = blank(frames), delay = blank(frames), reverb = blank(frames);
  for (let offset = 0; offset < frames; offset += 128) {
    const end = Math.min(frames, offset + 128), block = (mix: Mix) => mix.map(channel => channel.subarray(offset, end));
    if (withSends) core.process(kit[0].subarray(offset, end), kit[1].subarray(offset, end), block(delay), block(reverb));
    else core.process(kit[0].subarray(offset, end), kit[1].subarray(offset, end));
  }
  return { kit, delay, reverb };
}

test('with every drum sending all of itself, the delay mix and the reverb mix are the kit, and the kit is what it was', () => {
  for (const kit of DRUM_KITS) {
    for (const recordings of [false, true]) {
      const before = play(kit.id, () => ({ humanize: 0.35 }), false, recordings);
      for (const patch of [{ humanize: 0.35 }, { humanize: 0.35, delaySend: 1, reverbSend: 1 }]) {
        const { kit: main, delay, reverb } = play(kit.id, () => patch, true, recordings);
        assert.ok(energy(main[0]) > 1 && energy(main[1]) > 1, `${kit.id} is heard`);
        for (const side of [0, 1]) {
          assert.ok(same(main[side], before.kit[side]), `${kit.id}: the kit is sample for sample what it is with no send mixes asked for`);
          assert.ok(same(delay[side], main[side]), `${kit.id}: the delay mix is the kit`);
          assert.ok(same(reverb[side], main[side]), `${kit.id}: the reverb mix is the kit`);
        }
      }
    }
  }
});

test('a drum kept out of an effect is missing from that mix alone, and still in the kit', () => {
  const lone = (instrument: DrumInstrument, patch: Partial<DrumSettings>, recordings = false) => {
    const core = new DrumCore(SR);
    if (recordings) { core.setSample('snare', sample); core.setCymbals({ crash: cymbal }); }
    core.trigger({ instrument, kitId: 'tr-909', velocity: 1, settings: settings({ pan: -0.5, ...patch }) });
    const kit = blank(SR / 2), delay = blank(SR / 2), reverb = blank(SR / 2);
    core.process(kit[0], kit[1], delay, reverb);
    return { kit, delay, reverb };
  };
  const dry = lone('kick', { reverbSend: 0 });
  assert.ok(energy(dry.kit[0]) > 1, 'the kick is in the kit');
  assert.ok(silent(dry.reverb[0]) && silent(dry.reverb[1]), 'and not in the reverb');
  assert.ok(same(dry.delay[0], dry.kit[0]) && same(dry.delay[1], dry.kit[1]), 'and wholly in the delay');
  assert.ok(same(dry.kit[0], lone('kick', {}).kit[0]), 'its own sound is not changed by where it is sent');

  // A share is the same share on both sides, so the drum is in the same place in the effect.
  // The built-in voice, an imported sample and a recorded cymbal are all scaled alike.
  for (const [instrument, recordings] of [['kick', false], ['snare', true], ['crash', true], ['crash', false]] as const) {
    const half = lone(instrument, { delaySend: 0.5, reverbSend: 0.25 }, recordings);
    assert.ok(energy(half.kit[0]) > energy(half.kit[1]) && energy(half.kit[1]) > 0, `${instrument} is to the left`);
    for (const side of [0, 1]) {
      assert.ok(half.delay[side].every((value, index) => value === half.kit[side][index] * 0.5), `${instrument}: half of it in the delay`);
      assert.ok(half.reverb[side].every((value, index) => value === half.kit[side][index] * 0.25), `${instrument}: a quarter in the reverb`);
    }
  }

  // In a whole kit, taking one drum out of the reverb leaves the others in it.
  const all = play('clean-analog', () => ({}), true, true);
  const without = play('clean-analog', instrument => (instrument === 'kick' ? { reverbSend: 0 } : {}), true, true);
  const kickAlone = play('clean-analog', instrument => (instrument === 'kick' ? {} : { volume: 0 }), true, true);
  assert.ok(same(without.kit[0], all.kit[0]) && same(without.delay[0], all.delay[0]));
  assert.ok(without.reverb[0].every((value, index) => Math.abs(value + kickAlone.kit[0][index] - all.kit[0][index]) < 1e-6), 'the reverb mix is the kit less the kick');

  // A share that is nonsense is all of it or none, never more.
  for (const [value, kept] of [[Number.NaN, 1], [7, 1], [-2, 0], [Number.POSITIVE_INFINITY, 1]] as const) {
    const odd = lone('kick', { delaySend: value });
    assert.ok(odd.delay[0].every((sent, index) => sent === odd.kit[0][index] * kept), String(value));
  }
});

test('a drum\'s sends are stored only when they are less than all of it, and bounded', () => {
  const base = drums();
  const clean = sanitizeDrums(base, base);
  for (const instrument of DRUM_INSTRUMENTS) {
    assert.equal('delaySend' in clean[instrument].settings, false);
    assert.equal('reverbSend' in clean[instrument].settings, false);
  }
  const input = drums({ kick: { delaySend: 1, reverbSend: 0 }, snare: { delaySend: 0.3, reverbSend: 9 }, clap: { delaySend: -4, reverbSend: Number.NaN } }) as unknown as Record<string, { settings: Record<string, unknown> }>;
  input.ride.settings.delaySend = 'lots';
  input.crash.settings.reverbSend = null;
  const kept = sanitizeDrums(input, base);
  assert.deepEqual(kept.kick.settings, { ...base.kick.settings, reverbSend: 0 });
  assert.deepEqual(kept.snare.settings, { ...base.snare.settings, delaySend: 0.3 });
  assert.deepEqual(kept.clap.settings, { ...base.clap.settings, delaySend: 0 });
  assert.deepEqual(kept.ride.settings, base.ride.settings);
  assert.deepEqual(kept.crash.settings, base.crash.settings);
});

const loop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: false, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};

test('the store keeps a drum\'s sends through a kit change and a file, clears them on Reset, and an older project is untouched', async () => {
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
  const untouched = JSON.parse(JSON.stringify(service.exportProject()));
  assert.equal(JSON.stringify(untouched).includes('delaySend') || JSON.stringify(untouched).includes('reverbSend'), false, 'a project that never set one holds none');
  const hashBefore = await contentHash(service.normalized(untouched.project));

  assert.ok(service.setDrumSettings('kick', { reverbSend: 0, delaySend: 0.4 }).ok);
  assert.deepEqual([service.snapshot().drumState.kick.settings.reverbSend, service.snapshot().drumState.kick.settings.delaySend], [0, 0.4]);
  assert.equal('reverbSend' in service.snapshot().drumState.snare.settings, false, 'each drum has its own');
  assert.notEqual(await contentHash(service.normalized(service.exportProject().project)), hashBefore, 'a send is a change to the project');

  // Choosing a kit lays the kit's sound over the drums and leaves where each is sent.
  assert.ok(service.setDrumKit('tr-808').ok);
  assert.equal(service.snapshot().drumState.kick.settings.reverbSend, 0);
  assert.equal(service.snapshot().drumState.kick.settings.delaySend, 0.4);

  const file = JSON.parse(JSON.stringify(service.exportProject()));
  assert.equal(file.project.drumState.kick.settings.reverbSend, 0);

  // All of it again is stored as nothing: the control sends 1 and the checks drop it.
  assert.ok(service.setDrumSettings('kick', { delaySend: 1 }).ok);
  assert.equal('delaySend' in service.snapshot().drumState.kick.settings, false);
  assert.ok(service.resetDrums().ok);
  assert.equal('reverbSend' in service.snapshot().drumState.kick.settings, false, 'Reset puts every drum back in the effects');

  const imported = await service.importProject(file);
  assert.equal(imported.ok, true);
  assert.equal(service.snapshot().drumState.kick.settings.reverbSend, 0, 'a file brings them');
  assert.equal(service.snapshot().drumState.kick.settings.delaySend, 0.4);

  // A file from before a drum had sends opens as the project it was, and is not called damaged.
  const old = await service.importProject(untouched);
  assert.equal(old.ok, true);
  assert.notEqual((old as { damaged?: boolean }).damaged, true);
  assert.deepEqual(service.exportProject().project.drumState, (service.normalized(untouched.project) as typeof untouched.project).drumState);
  assert.equal(await contentHash(service.normalized(untouched.project)), hashBefore, 'and is not a changed project to sync');
  // One that says "all of it" out loud is the same project as one that says nothing.
  const explicit = JSON.parse(JSON.stringify(untouched));
  for (const instrument of DRUM_INSTRUMENTS) Object.assign(explicit.project.drumState[instrument].settings, { delaySend: 1, reverbSend: 1 });
  assert.equal(await contentHash(service.normalized(explicit.project)), hashBefore);
});

test('a controller\'s knob can be tied to a drum\'s sends, over the range the store keeps', () => {
  for (const key of ['delaySend', 'reverbSend'] as const) {
    const parsed = parseTarget(`drum:snare:${key}`);
    assert.ok(parsed && parsed.kind === 'drum' && parsed.key === key);
    for (const unit of [0, 0.5, 1]) {
      const value = fromUnit(DRUM_PARAMS[key], unit);
      const kept = sanitizeDrums(drums({ snare: { [key]: value } }), drums()).snare.settings[key] ?? 1;
      assert.equal(kept, value, `${key} at ${unit}`);
    }
  }
  assert.equal(targetLabel('drum:kick:delaySend'), 'Kick: To delay');
  assert.equal(targetLabel('drum:crash:reverbSend'), 'Cymbal: To reverb');
});

test('an export makes a mix of its own for an effect only when a drum that plays is held back from it', () => {
  const arrangement = (state: DrumState) => ({ tempo: 120, drumState: state, drumKitId: 'tr-909', drumMasterVolume: 0.9, drumSwing: 0.1 });
  const on = { kick: [0, 8], snare: [4, 12], closedHH: [2, 6, 10, 14] };
  const plain = renderDrumMixes(arrangement(drums({}, on)), SR, SR);
  assert.deepEqual(Object.keys(plain), ['kit'], 'a project that set none renders the one mix it always did');

  const dryKick = renderDrumMixes(arrangement(drums({ kick: { reverbSend: 0 } }, on)), SR, SR);
  assert.deepEqual(Object.keys(dryKick), ['kit', 'reverb']);
  assert.ok(same(dryKick.kit[0], plain.kit[0]) && same(dryKick.kit[1], plain.kit[1]), 'the kit itself is unchanged');
  assert.ok(same(renderDrums(arrangement(drums({ kick: { reverbSend: 0 } }, on)), SR, SR)[0], plain.kit[0]));
  const noKick = renderDrumMixes(arrangement(drums({}, { ...on, kick: [] })), SR, SR);
  assert.ok(dryKick.reverb![0].every((value, index) => Math.abs(value - noKick.kit[0][index]) < 1e-6), 'the reverb is sent the kit without its kick');

  const both = renderDrumMixes(arrangement(drums({ snare: { delaySend: 0.5, reverbSend: 0.5 } }, on)), SR, SR);
  assert.deepEqual(Object.keys(both), ['kit', 'delay', 'reverb']);
  assert.ok(same(both.delay![0], both.reverb![0]) && !same(both.delay![0], both.kit[0]));
  assert.deepEqual(renderDrumMixes(arrangement(drums({ snare: { delaySend: 0.5, reverbSend: 0.5 } }, on)), SR, SR), both, 'and renders the same every time');

  // A drum that has a share set but never plays, or is muted, asks for nothing.
  assert.deepEqual(Object.keys(renderDrumMixes(arrangement(drums({ clap: { delaySend: 0 } }, on)), SR, SR)), ['kit']);
  const muted = drums({ kick: { delaySend: 0 } }, on);
  muted.kick.muted = true;
  assert.deepEqual(Object.keys(renderDrumMixes(arrangement(muted), SR, SR)), ['kit']);
});

// Enough of an offline context to see what an export connects to what.
class Param {
  value = 0;
  setTargetAtTime() {}
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}
class Node {
  to: Node[] = [];
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  curve?: Float32Array; oversample?: string; type?: string; channelCount?: number; channelCountMode?: string;
  buffer?: { getChannelData(channel: number): Float32Array };
  constructor(readonly kind: string) {}
  connect(node: Node) { this.to.push(node); return node; }
  start() {}
}
class Offline {
  static last: Offline;
  nodes: Node[] = [];
  destination = new Node('destination');
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) { Offline.last = this; }
  private node(kind: string) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain = () => { const node = this.node('gain'); node.gain.value = 1; return node; };
  createDynamicsCompressor = () => this.node('limiter');
  createWaveShaper = () => this.node('shaper');
  createDelay = () => this.node('delay');
  createConvolver = () => this.node('convolver');
  createBiquadFilter = () => this.node('filter');
  createOscillator = () => this.node('oscillator');
  createChannelMerger = () => this.node('merger');
  createBufferSource = () => this.node('source');
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (channel: number) => data[channel] };
  }
  startRendering = async () => this.createBuffer(2, this.length);
  // The gain a source goes into (its ducker), and what feeds a kind of effect.
  into = (kind: string) => this.nodes.filter(node => node.kind === 'gain' && node.to.some(next => next.kind === 'gain' && next.to.some(after => after.kind === kind)));
}

test('an export sends the kit to its effects as it always did, and a held-back drum changes only what the delay or the reverb is fed', async () => {
  const original = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext = Offline as unknown as typeof OfflineAudioContext;
  try {
    const on = { kick: [0, 8], snare: [4, 12] }, driven = { ...loop, drive: { ...loop.drive, enabled: true } };
    const arrangement = (state: DrumState, effectsLoop: EffectsLoopState): ExportArrangement => ({
      tempo: 120, synths: [], drumState: state, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0,
      drumFx: { sends: { reverb: .3, delay: .2, drive: .4, phaser: 0 }, returnLevel: 1 }, effectsLoop,
    });
    const graph = async (state: DrumState, effectsLoop = driven) => {
      await renderArrangement(arrangement(state, effectsLoop));
      const ctx = Offline.last, sources = ctx.nodes.filter(node => node.kind === 'source');
      return { ctx, sources, duckers: sources.map(source => source.to[0]), shape: ctx.nodes.map(node => `${node.kind}>${node.to.map(next => next.kind).join(',')}`) };
    };

    const plain = await graph(drums({}, on));
    assert.equal(plain.sources.length, 1, 'one signal for the kit');
    assert.deepEqual(plain.ctx.into('delay'), plain.duckers, 'which feeds the delay');
    assert.deepEqual(plain.ctx.into('convolver'), plain.duckers, 'and the reverb');
    // Saying "all of it" for every drum is the same export, node for node and sample for sample.
    const explicit = await graph(drums(Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { delaySend: 1, reverbSend: 1 }])), on));
    assert.deepEqual(explicit.shape, plain.shape);
    assert.ok(same(explicit.sources[0].buffer!.getChannelData(0), plain.sources[0].buffer!.getChannelData(0)));

    const dry = await graph(drums({ kick: { reverbSend: 0 } }, on));
    assert.equal(dry.sources.length, 2, 'the kit, and what it sends to the reverb');
    assert.ok(same(dry.sources[0].buffer!.getChannelData(0), plain.sources[0].buffer!.getChannelData(0)), 'the kit is what it was');
    assert.deepEqual(dry.ctx.into('delay'), [dry.duckers[0]], 'the delay still takes the kit');
    assert.deepEqual(dry.ctx.into('convolver'), [dry.duckers[1]], 'the reverb takes its own mix and not the kit');
    assert.equal(dry.duckers[1].to.length, 1, 'which goes nowhere else');
    assert.equal(dry.duckers[1].to[0].gain.value, .3, 'at the kit\'s own send: the master over every drum\'s');
    assert.deepEqual(dry.ctx.into('shaper'), [dry.duckers[0]], 'drive is the whole kit\'s');
    const heldBack = dry.sources[1].buffer!.getChannelData(0), kit = dry.sources[0].buffer!.getChannelData(0);
    assert.ok(energy(heldBack) > 0.1 && energy(heldBack) < energy(kit) * 0.9, 'the snare is in it and the kick is not');

    // An effect that is off, or that the kit sends nothing to, is given no mix at all.
    assert.equal((await graph(drums({ kick: { reverbSend: 0, delaySend: 0 } }, on), { ...loop, enabled: false })).sources.length, 1);
    assert.equal((await graph(drums({ kick: { reverbSend: 0 } }, on), { ...loop, reverb: { ...loop.reverb, enabled: false } })).sources.length, 1);
  } finally { globalThis.OfflineAudioContext = original; }
});

// Enough of a live context for a lane.
class LiveNode {
  to: LiveNode[] = [];
  gain = { value: 1, setTargetAtTime(value: number) { this.value = value; } };
  frequency = { value: 0, setTargetAtTime() {} }; Q = { value: 0 }; delayTime = { value: 0, setTargetAtTime() {} };
  threshold = { value: 0 }; knee = { value: 0 }; ratio = { value: 0 }; attack = { value: 0 }; release = { value: 0 };
  curve?: Float32Array; oversample?: string; type?: string; buffer?: unknown; channelCount?: number; channelCountMode?: string;
  connect(node: LiveNode) { this.to.push(node); return node; }
  disconnect() { this.to = []; }
  start() {}
  stop() {}
}
const liveContext = () => {
  const make = () => new LiveNode();
  return {
    sampleRate: 1000, currentTime: 0, state: 'running', destination: make(), close: async () => {},
    createGain: make, createDynamicsCompressor: make, createWaveShaper: make, createDelay: make, createConvolver: make,
    createBiquadFilter: make, createOscillator: make, createChannelMerger: make,
    createBuffer: (channels: number, length: number) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (channel: number) => data[channel] }; },
  } as unknown as AudioContext;
};

test('live, the drums\' delay and reverb sends are fed from mixes of their own, with the kit\'s level, sends and ducking', async () => {
  const engine = new AudioEngine(liveContext);
  try {
    const plain = engine.createLane('drums');
    assert.deepEqual(plain.taps, {}, 'a lane that asks for none has none');
    assert.equal((plain.output as unknown as LiveNode).to.length, 8, 'and sends its own signal to all seven effects');

    const lane = engine.createLane('drums', ['delay', 'reverb']);
    const ducker = lane.output as unknown as LiveNode, delay = lane.taps.delay as unknown as LiveNode, reverb = lane.taps.reverb as unknown as LiveNode;
    assert.ok(delay && reverb && delay !== reverb);
    assert.equal(ducker.to.length, 6, 'the kit goes to the master and to drive, phaser, chorus and the two aux buses');
    lane.setSends({ reverb: 0.8, delay: 0.6, drive: 0.5, phaser: 0.4, chorus: 0.3 }, 0.5);
    assert.deepEqual(ducker.to.slice(1).map(node => node.gain.value), [0.25, 0.2, 0.15, 0, 0]);
    // Each mix: the lane's volume, then its ducking, then the kit's send to that effect.
    const sendOf = (tap: LiveNode) => { assert.equal(tap.to.length, 1); assert.equal(tap.to[0].to.length, 1); return tap.to[0].to[0]; };
    assert.equal(sendOf(delay).gain.value, 0.3, 'the kit\'s delay send is the level of the delay mix');
    assert.equal(sendOf(reverb).gain.value, 0.4);
    assert.equal(sendOf(delay).to.length, 1, 'and goes on into the effect');
    assert.equal(ducker.to.includes(sendOf(delay)) || ducker.to.includes(sendOf(reverb)), false, 'the kit does not also go there');
    lane.setVolume(0.7);
    assert.deepEqual([(lane.input as unknown as LiveNode).gain.value, delay.gain.value, reverb.gain.value], [0.7, 0.7, 0.7], 'the drums\' level is on all three');
    lane.duck(0, 1);
    assert.deepEqual([ducker, delay.to[0], reverb.to[0]].map(node => node.gain.value), [1, 1, 1], 'a duck dips all three and comes back');
    lane.dispose();
    assert.deepEqual([delay.to.length, reverb.to.length], [0, 0]);
  } finally { await engine.dispose(); }
});
