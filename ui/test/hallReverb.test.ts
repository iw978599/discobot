import test from 'node:test';
import assert from 'node:assert/strict';
import type { DrumInstrument } from '@discobot/engine';
import { createHallReverb, hallDampDb, hallDampHz, hallFeedback, hallLevel, HALL_LEVEL, reverbImpulse } from '../src/hooks/browserAudio.ts';
import { seededRandom } from '../src/services/drumScheduling.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { sanitizeEffects } from '../src/services/projectSanitization.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { type ExportArrangement, renderArrangement } from '../src/services/wavExport.ts';
import { GraphContext } from './helpers/audioGraph.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const RATE = 44100;
type Reverb = EffectsLoopState['reverb'];
const hallOf = (decay: number, damping = 0, preDelay = 0): Reverb => ({ enabled: true, decay, mix: 1, kind: 'hall', damping, preDelay });

// The Hall's answer to one click, played through the graph `createHallReverb` builds.
function hallResponse(settings: Reverb, seconds: number, rate = RATE) {
  const ctx = new GraphContext(rate);
  const hall = createHallReverb(ctx as unknown as BaseAudioContext);
  hall.set(settings);
  const click = new Float32Array(1); click[0] = 1;
  return ctx.render(hall.input, hall.output, click, Math.round(seconds * rate));
}
const energy = (samples: Float32Array, from = 0, to = samples.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return sum;
};
// Seconds to fall 60 dB, from the slope of the energy still to come between -5 and -25 dB.
function decayTime(channels: Float32Array[], rate = RATE) {
  const length = channels[0].length, remaining = new Float64Array(length);
  let sum = 0;
  for (let i = length - 1; i >= 0; i--) { sum += channels[0][i] ** 2 + channels[1][i] ** 2; remaining[i] = sum; }
  const db = (i: number) => 10 * Math.log10(remaining[i] / remaining[0]);
  const at = (level: number) => { let i = 0; while (i < length - 1 && db(i) > level) i++; return i; };
  return (at(-25) - at(-5)) / rate * 3;
}
// The Room's answer to one click: its impulse, scaled the way a browser's convolver normalizes one.
function roomResponse(decay: number, damping = 0) {
  const ctx = { sampleRate: RATE, createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (channel: number) => data[channel] };
  } } as unknown as BaseAudioContext;
  const impulse = reverbImpulse(ctx, decay, seededRandom(3), 0, damping);
  const channels = [impulse.getChannelData(0), impulse.getChannelData(1)];
  const power = Math.max(0.000125, Math.sqrt((energy(channels[0]) + energy(channels[1])) / (2 * impulse.length)));
  const scale = 1 / power * Math.pow(10, -58 / 20);
  return channels.map(channel => channel.map(value => value * scale));
}
const decibels = (channels: Float32Array[]) => 10 * Math.log10(energy(channels[0]) + energy(channels[1]));
// Energy in the sample-to-sample change: large for hiss, small for a dull sound.
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / energy(samples);

test('the Hall is eight lines behind two all-passes, every loop longer than a render quantum, and two sides', () => {
  const ctx = new GraphContext(RATE);
  const hall = createHallReverb(ctx as unknown as BaseAudioContext);
  hall.set(hallOf(2));
  assert.equal(hall.lines.length, 8);
  const delays = ctx.nodes.filter(node => node.kind === 'delay');
  assert.equal(delays.length, 11, 'a pre-delay, two all-passes and eight lines');
  assert.equal(ctx.nodes.filter(node => node.kind === 'filter').length, 8);
  assert.ok(hall.lines.every(line => line.delay.delayTime.value * RATE >= 128), 'no line is shorter than a render quantum');
  assert.equal(new Set(hall.lines.map(line => line.seconds)).size, 8, 'every line is its own length');
  assert.ok([...ctx.nodes].every(node => node.kind === 'merger' || (node.channelCount === 1 && node.channelCountMode === 'explicit')), 'everything inside is one channel');
  assert.deepEqual(hall.sides.map(side => side.level.gain.value), [hallLevel(2, 0), hallLevel(2, 0)]);
  // At 48 kHz every line is a whole number of frames too: the renderer refuses anything else.
  assert.ok(decayTime(hallResponse(hallOf(1), 1.2, 48000), 48000) > 0.9);
});

test('a line gives back what makes its echoes fall 60 dB in the decay, and damping is a shelf in proportion', () => {
  assert.ok(Math.abs(hallFeedback(2, 0.04) - Math.pow(10, -3 * 0.04 / 2)) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(hallFeedback(2, 0.04)) * (2 / 0.04) + 60) < 1e-9, '60 dB over the decay, whatever the line');
  assert.equal(hallFeedback(-5, 0.04), hallFeedback(0.1, 0.04), 'a hostile decay is bounded');
  assert.equal(hallDampDb(2, 0, 0.04), -0, 'no damping is a flat shelf');
  assert.equal(hallDampDb(2, undefined, 0.04), -0);
  assert.ok(Math.abs(hallDampDb(2, 1, 0.04) - 5 * 20 * Math.log10(hallFeedback(2, 0.04))) < 1e-9, 'full damping: highs fall six times as fast');
  assert.equal(hallDampHz(0), 8000);
  assert.equal(hallDampHz(1), 2000);
  assert.ok(hallLevel(8, 0) < HALL_LEVEL && hallLevel(8, 0) > HALL_LEVEL * 0.98 && hallLevel(0.2, 0) < HALL_LEVEL * 0.6, 'a short Hall is brought down');
  assert.ok(hallLevel(5, 1) / hallLevel(5, 0) > hallLevel(0.5, 1) / hallLevel(0.5, 0) && hallLevel(0.5, 1) > hallLevel(0.5, 0), 'damping is made up for, more for a long tail');

  const ctx = new GraphContext(RATE);
  const hall = createHallReverb(ctx as unknown as BaseAudioContext);
  hall.set(hallOf(3, 0.5, 0.1));
  for (const line of hall.lines) {
    assert.equal(line.back.gain.value, hallFeedback(3, line.seconds));
    assert.equal(line.shelf.type, 'highshelf');
    assert.equal(line.shelf.frequency.value, hallDampHz(0.5));
    assert.equal(line.shelf.gain.value, hallDampDb(3, 0.5, line.seconds));
  }
  assert.equal(hall.pre.delayTime.value, 0.1);
  hall.set({ ...hallOf(3), preDelay: 9 });
  assert.equal(hall.pre.delayTime.value, 0.25, 'a hostile pre-delay is bounded');
});

test('the Hall falls 60 dB in the decay it is given', () => {
  // Measured from the graph itself, played through: within 5% from half a second to eight.
  for (const decay of [0.5, 2, 5, 8]) {
    const measured = decayTime(hallResponse(hallOf(decay), decay * 1.1));
    assert.ok(Math.abs(measured / decay - 1) < 0.05, `asked ${decay}s, measured ${measured.toFixed(3)}s`);
  }
  const damped = decayTime(hallResponse(hallOf(2, 1), 2.2)), open = decayTime(hallResponse(hallOf(2), 2.2));
  assert.ok(damped < open, 'damping shortens the tail as a whole, since its highs go first');
});

test('the Hall is about as loud as the Room at the same mix', () => {
  for (const [decay, damping] of [[0.2, 0], [0.5, 0], [2.1, 0], [5, 0], [8, 0], [2.1, 0.35], [2.1, 1], [0.5, 1], [5, 0.5], [8, 1]]) {
    const hall = decibels(hallResponse(hallOf(decay, damping), decay * 1.3)), room = decibels(roomResponse(decay, damping));
    assert.ok(Math.abs(hall - room) < 1.5, `decay ${decay}s, damping ${damping}: Hall ${hall.toFixed(1)} dB, Room ${room.toFixed(1)} dB`);
  }
});

test('the Hall is stereo, darker as it is damped, held back by its pre-delay, and the same every time', () => {
  const [left, right] = hallResponse(hallOf(1.5), 1.5);
  let both = 0;
  for (let i = 0; i < left.length; i++) both += left[i] * right[i];
  assert.ok(Math.abs(both) / Math.sqrt(energy(left) * energy(right)) < 0.2, 'the two sides are different signals');

  const late = (channels: Float32Array[]) => channels[0].subarray(RATE * 0.5, RATE);
  const open = hallResponse(hallOf(1.5), 1), damped = hallResponse(hallOf(1.5, 1), 1);
  assert.ok(brightness(late(damped)) < brightness(late(open)) * 0.5, 'a damped tail has lost its highs');

  const held = hallResponse(hallOf(1.5, 0, 0.1), 1);
  const first = (samples: Float32Array) => samples.findIndex(value => value !== 0);
  assert.equal(first(held[0]) - first(open[0]), RATE * 0.1, 'the pre-delay is silence before the reverb');
  assert.deepEqual(hallResponse(hallOf(1.5, 0.4), 0.5), hallResponse(hallOf(1.5, 0.4), 0.5));
});

test('the reverb kind is kept only when it is the Hall', () => {
  const loop: EffectsLoopState = {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  };
  assert.deepEqual(sanitizeEffects(loop, loop), loop, 'a project that never chose one has none');
  assert.deepEqual(sanitizeEffects({ ...loop, reverb: { ...loop.reverb, kind: 'hall' } }, loop).reverb, { ...loop.reverb, kind: 'hall' });
  for (const kind of ['room', 'cathedral', 7, null, { hall: true }]) {
    assert.equal('kind' in sanitizeEffects({ ...loop, reverb: { ...loop.reverb, kind } }, loop).reverb, false, `${JSON.stringify(kind)} is stored as nothing`);
  }
});

test('the store keeps the Hall, a project file carries it, and choosing the Room again takes it away', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const loop: EffectsLoopState = {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  };
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(),
    drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
      steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
    }])) as DrumState,
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0, chorus: 0 }, returnLevel: .7 },
    effectsLoop: loop,
  });
  assert.equal('kind' in service.snapshot().effectsLoop.reverb, false, 'a new project starts with the Room');
  service.setEffectsLoop({ reverb: { ...service.snapshot().effectsLoop.reverb, kind: 'hall' } });
  assert.equal(service.snapshot().effectsLoop.reverb.kind, 'hall');
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  assert.equal(file.project.effectsLoop.reverb.kind, 'hall');
  service.setEffectsLoop({ reverb: { ...service.snapshot().effectsLoop.reverb, kind: 'room' } });
  assert.equal('kind' in service.snapshot().effectsLoop.reverb, false, 'the Room is stored as nothing');
  assert.equal((await service.importProject(file)).ok, true);
  assert.equal(service.snapshot().effectsLoop.reverb.kind, 'hall', 'a file with the Hall opens with it');
  delete file.project.effectsLoop.reverb.kind;
  const older = await service.importProject(file);
  assert.equal(older.ok, true, 'a file from before there was a choice opens, and is not reported damaged');
  assert.equal('kind' in service.snapshot().effectsLoop.reverb, false);
});

// Enough of an offline context to see what an export connects to what.
class Param { value = 0; setTargetAtTime() {} setValueAtTime() {} linearRampToValueAtTime() {} }
class Node {
  to: Node[] = [];
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  curve?: Float32Array; oversample?: string; type?: string; channelCount?: number; channelCountMode?: string; buffer?: unknown;
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
}

test('an export of a project that never chose a kind is the graph it always was, and the Hall takes the reverb send in its place', async () => {
  const original = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext = Offline as unknown as typeof OfflineAudioContext;
  try {
    const loop: EffectsLoopState = {
      enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: false, amount: .2, tone: .6 },
      phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
      delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3, preDelay: .02, damping: .35 },
    };
    const drums = (reverbSend?: number) => Object.fromEntries(DRUM_INSTRUMENTS.map((instrument: DrumInstrument) => [instrument, {
      steps: Array.from({ length: 16 }, (_, step) => instrument === 'kick' ? step % 4 === 0 : instrument === 'snare' && step % 8 === 4),
      muted: false, solo: false,
      settings: { volume: .8, tone: .5, extra: .5, tune: 0, humanize: 0, pan: 0, ...(instrument === 'kick' && reverbSend !== undefined ? { reverbSend } : {}) },
    }])) as DrumState;
    const graph = async (effectsLoop: EffectsLoopState, reverbSend?: number) => {
      const arrangement: ExportArrangement = {
        tempo: 120, synths: [], drumState: drums(reverbSend), drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0,
        drumFx: { sends: { reverb: .3, delay: .2, drive: 0, phaser: 0 }, returnLevel: 1 }, effectsLoop,
      };
      await renderArrangement(arrangement);
      const ctx = Offline.last;
      return { ctx, shape: ctx.nodes.map(node => `${node.kind}>${node.to.map(next => next.kind).join(',')}`) };
    };
    const untouched = await graph(loop);
    // The graph as it was before there was a choice of reverb, node for node.
    assert.deepEqual(untouched.shape, [
      'gain>limiter', 'limiter>shaper', 'shaper>destination', 'source>gain', 'gain>gain,gain,gain', 'gain>gain',
      'delay>gain,gain', 'gain>delay', 'gain>gain', 'gain>delay', 'convolver>gain', 'gain>gain', 'gain>convolver',
    ]);
    assert.deepEqual((await graph({ ...loop, reverb: { ...loop.reverb, kind: 'room' } })).shape, untouched.shape, 'naming the Room changes nothing');

    const hall = await graph({ ...loop, reverb: { ...loop.reverb, kind: 'hall' } });
    assert.equal(hall.ctx.nodes.filter(node => node.kind === 'convolver').length, 0, 'the Hall is in the Room\'s place, not beside it');
    const merger = hall.ctx.nodes.find(node => node.kind === 'merger')!;
    const level = merger.to[0];
    assert.equal(level.gain.value, .3, 'it comes back at the reverb\'s mix');
    const send = hall.ctx.nodes.find(node => node.kind === 'gain' && node.gain.value === .3 && node.to.some(next => next.channelCount === 1))!;
    assert.ok(send, 'and is fed the drums\' send to the reverb');
    assert.equal(hall.ctx.nodes.filter(node => node.kind === 'filter' && node.type === 'highshelf').length, 8);

    // A drum held back from the reverb feeds the Hall from the drums' own mix, as it feeds the Room.
    const own = await graph({ ...loop, reverb: { ...loop.reverb, kind: 'hall' } }, 0);
    const sources = own.ctx.nodes.filter(node => node.kind === 'source');
    assert.equal(sources.length, 2, 'the kit, and what it sends to the reverb');
    const ownSend = sources[1].to[0].to[0];
    assert.equal(ownSend.gain.value, .3);
    assert.equal(ownSend.to.length, 1);
    assert.equal(ownSend.to[0].channelCount, 1, 'the reverb\'s own mix goes into the Hall alone');
  } finally { globalThis.OfflineAudioContext = original; }
});
