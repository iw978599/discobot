import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/hooks/browserAudio';
import { AUX_DEFAULT, AUX_KIND_DEFAULT, auxBuses, auxRate, auxSeconds, sanitizeAux } from '../src/services/auxSettings';
import { guestSends } from '../src/services/guests';
import { sanitizeEffects, sanitizeSends, sanitizeSynthParams } from '../src/services/projectSanitization';
import { createDefaultSynthParameters } from '@discobot/engine';
import type { EffectsLoopState } from '../src/types';

class Param {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class Node {
  connections: Node[] = [];
  stopped = false;
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  curve?: Float32Array; oversample?: string; buffer?: unknown; type?: string; channelCount?: number; channelCountMode?: string;
  constructor(readonly kind: string) {}
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect(target?: Node) { this.connections = target ? this.connections.filter(node => node !== target) : []; }
  start() { /* the sweeps are not heard here */ }
  stop() { this.stopped = true; }
}
class Context {
  sampleRate = 1000; currentTime = 0; state = 'running'; destination = new Node('destination');
  nodes: Node[] = [];
  audioWorklet = { addModule: async () => {} };
  resume = async () => {};
  close = async () => { this.state = 'closed'; };
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
    return { getChannelData: (channel: number) => data[channel] };
  }
  private node(kind: string) { const node = new Node(kind); this.nodes.push(node); return node; }
}

const LOOP: EffectsLoopState = {
  enabled: true, returns: { synth: 0.7, drums: 0.6 },
  drive: { enabled: true, amount: 0.5, tone: 0.25 },
  delay: { enabled: true, time: 0.3, feedback: 0.4, mix: 0.8 },
  reverb: { enabled: true, decay: 1, mix: 0.7 },
  phaser: { enabled: true, rate: 0.5, depth: 0.5, feedback: 0.3, mix: 0.6 },
};
const SENDS = { reverb: 0, delay: 0, drive: 0, phaser: 0, chorus: 0 };
function make() {
  const contexts: Context[] = [];
  const engine = new AudioEngine(() => { const context = new Context(); contexts.push(context); return context as unknown as AudioContext; });
  engine.setEffectsLoop(LOOP);
  return { engine, ctx: () => contexts[0] };
}
const kinds = (ctx: Context, kind: string) => ctx.nodes.filter(node => node.kind === kind).length;

test('nothing is built for an aux bus until something is sent to it', async () => {
  const { engine, ctx } = make();
  const lane = engine.createLane('synth');
  lane.setSends(SENDS, 1);
  const quiet = ctx().nodes.length;
  lane.setSends({ ...SENDS, auxA: 0, auxB: 0 }, 1);
  assert.equal(ctx().nodes.length, quiet, 'a lane that sends nothing there builds nothing');
  const delays = kinds(ctx(), 'delay');
  lane.setSends({ ...SENDS, auxA: 0.5 }, 1);
  assert.equal(kinds(ctx(), 'delay'), delays + 1, 'bus A is an echo to start with: one delay line');
  lane.setSends({ ...SENDS, auxA: 0.5 }, 1);
  assert.equal(kinds(ctx(), 'delay'), delays + 1, 'and is built once');
  await engine.dispose();
});

test('a send to an aux bus is the lane\'s send, its level the bus\'s, and the return is the unit\'s', async () => {
  const { engine, ctx } = make();
  const lane = engine.createLane('synth');
  const before = ctx().nodes.length;
  lane.setSends({ ...SENDS, auxB: 0.5 }, 0.5);
  assert.ok(ctx().nodes.length > before, 'bus B is a Hall to start with');
  const sends = (lane.output as unknown as Node).connections.slice(1);
  assert.equal(sends.length, 7);
  assert.equal(sends[5].gain.value, 0, 'bus A has no send');
  assert.equal(sends[6].gain.value, 0.25, 'the send is its level times the lane\'s return');
  await engine.dispose();
});

test('pointing a bus at another effect swaps the effect and lets the old one go', async () => {
  const { engine, ctx } = make();
  const lane = engine.createLane('synth');
  lane.setSends({ ...SENDS, auxA: 1 }, 1);
  const oscillators = kinds(ctx(), 'oscillator');
  engine.setEffectsLoop({ ...LOOP, aux: [{ ...AUX_KIND_DEFAULT.chorus }, AUX_DEFAULT[1]] });
  assert.equal(kinds(ctx(), 'oscillator'), oscillators + 1, 'the chorus brings a sweep of its own');
  const sweep = ctx().nodes.filter(node => node.kind === 'oscillator').at(-1)!;
  await new Promise(resolve => setTimeout(resolve, 200));
  engine.setEffectsLoop({ ...LOOP, aux: [{ ...AUX_KIND_DEFAULT.echo }, AUX_DEFAULT[1]] });
  await engine.dispose();
  assert.equal(sweep.stopped, true, 'and it is stopped with the engine');
});

test('the buses a project starts with, and what an older project stores', () => {
  assert.deepEqual(auxBuses(undefined), AUX_DEFAULT);
  assert.equal(AUX_DEFAULT[0].kind, 'echo');
  assert.equal(AUX_DEFAULT[1].kind, 'hall');
  const loop = sanitizeEffects(LOOP, LOOP);
  assert.equal('aux' in loop, false, 'a project saved before them stores none');
  assert.equal(sanitizeAux(AUX_DEFAULT), undefined, 'and buses left as they start store none');
  assert.equal(sanitizeAux('echo'), undefined);
  assert.deepEqual(sanitizeEffects({ ...LOOP, aux: AUX_DEFAULT }, LOOP), loop);
});

test('stored buses are checked against their kind', () => {
  const hostile = sanitizeAux([
    { kind: 'chorus', level: 9, main: 1e9, shape: -3, sync: 'weekly' },
    { kind: 'flanger', level: -1, main: 'slow', shape: NaN, sync: '1/4' },
  ])!;
  assert.deepEqual(hostile[0], { kind: 'chorus', level: 1, main: 8, shape: 0 });
  assert.deepEqual(hostile[1], { ...AUX_DEFAULT[1], level: 0 }, 'an unknown kind is the slot\'s own, and a sync is dropped where it does not apply');
  assert.deepEqual(sanitizeAux([{ kind: 'echo', level: 0.6, main: 0.375, shape: 0.4, sync: '1/8' }])![0].sync, '1/8');
  assert.equal(sanitizeAux([{ kind: 'hall', level: 0.8, main: 2.5, shape: 0.4, sync: '1/8' }, { kind: 'hall' }])![0].sync, undefined, 'the Hall does not follow the tempo');
  assert.deepEqual(sanitizeAux([{ kind: 'echo', level: 0.2 }])![0], { ...AUX_DEFAULT[0], level: 0.2 });
});

test('a synced echo and chorus take their time and rate from the tempo', () => {
  const echo = { ...AUX_KIND_DEFAULT.echo, sync: '1/8' as const }, chorus = { ...AUX_KIND_DEFAULT.chorus, sync: '1/4' as const };
  assert.equal(auxSeconds(echo, 120), 0.25);
  assert.equal(auxSeconds(AUX_KIND_DEFAULT.echo, 120), 0.375);
  assert.equal(auxRate(chorus, 120), 2);
  assert.equal(auxRate(AUX_KIND_DEFAULT.chorus, 120), 0.6);
});

test('aux sends are stored only above nothing, for a lane, the kit and a guest', () => {
  const defaults = createDefaultSynthParameters();
  assert.equal('auxA' in sanitizeSynthParams(defaults, defaults).fxSends, false, 'a lane saved before them is unchanged');
  const lane = sanitizeSynthParams({ ...defaults, fxSends: { ...defaults.fxSends, auxA: 0.4, auxB: 0 } }, defaults);
  assert.equal(lane.fxSends.auxA, 0.4);
  assert.equal('auxB' in lane.fxSends, false);
  const hostile = sanitizeSends({ reverb: 0.2, auxA: 7, auxB: 'x' }, defaults.fxSends);
  assert.equal(hostile.auxA, 1);
  assert.equal('auxB' in hostile, false);

  assert.equal(guestSends({ reverb: 0.5 })?.auxA, undefined, 'a guest saved before them is unchanged');
  assert.equal(guestSends({ auxB: 0.3 })?.auxB, 0.3);
  assert.equal(guestSends({ auxA: 0 }), undefined);
});
