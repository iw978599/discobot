import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioEngine, MASTER_LEVEL, audioEngine, createAudioLane, ensureAudioReady, getAudioContext, loadAudioWorklet,
  playSample, scheduleClick, setEffectsLoop, setEffectsTempo, setMasterMuted, setMasterVolume, stopAllSamples,
} from '../src/hooks/browserAudio';
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
  started = false; stopped = false; cut = 0;
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  curve?: Float32Array; oversample?: string; buffer?: unknown; type?: string; channelCount?: number; channelCountMode?: string;
  onended?: () => void;
  constructor(readonly kind: string) {}
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect(target?: Node) {
    if (target && !this.connections.includes(target)) throw new Error('not connected');
    this.connections = target ? this.connections.filter(node => node !== target) : [];
    if (!target) this.cut++;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class Context {
  sampleRate = 1000; currentTime = 0; state = 'running'; destination = new Node('destination');
  modules: string[] = [];
  nodes: Node[] = [];
  audioWorklet = { addModule: async (url: string) => { this.modules.push(url); } };
  resume = async () => { this.state = 'running'; };
  close = async () => { this.state = 'closed'; };
  decodeAudioData = async () => ({ duration: 1 });
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
  chorus: { enabled: true, rate: 0.9, depth: 0.5, mix: 0.55 },
  eq: { enabled: true, low: 3, mid: -2, high: 6 },
};

function make() {
  const contexts: Context[] = [];
  const engine = new AudioEngine(() => {
    const context = new Context();
    contexts.push(context);
    return context as unknown as AudioContext;
  });
  return { engine, contexts };
}
const masterOf = (lane: { output: GainNode }) => (lane.output as unknown as Node).connections[0];
const eqOf = (master: Node) => [master.connections[0], master.connections[0].connections[0], master.connections[0].connections[0].connections[0]];

test('an engine makes its context once and everything it is asked for goes through one master', async () => {
  const { engine, contexts } = make();
  assert.equal(contexts.length, 0, 'nothing is made until it is needed');
  engine.setMasterVolume(0.5);
  engine.setEffectsLoop(LOOP);
  const synth = engine.createLane('synth'), drums = engine.createLane('drums');
  assert.equal(contexts.length, 1);
  assert.equal(engine.getContext(), contexts[0] as unknown as AudioContext);
  const master = masterOf(synth);
  assert.equal(masterOf(drums), master);
  assert.equal(master.gain.value, MASTER_LEVEL * 0.5, 'a volume set before the context exists is the level it starts at');
  assert.deepEqual(eqOf(master).map(node => node.gain.value), [3, -2, 6], 'and so are effects set before it');
  assert.equal(await engine.ensureReady(), true);
  await Promise.all([engine.loadWorklet(), engine.loadWorklet()]);
  assert.equal(contexts[0].modules.length, 1);
  await engine.dispose();
});

test('disposing stops and disconnects what the engine made and closes its context', async () => {
  const { engine, contexts } = make();
  engine.setEffectsLoop(LOOP);
  const synth = engine.createLane('synth');
  engine.createLane('drums');
  const ctx = contexts[0];
  engine.setEffectsLoop({ ...LOOP, reverb: { ...LOOP.reverb, decay: 2 }, drive: { ...LOOP.drive, amount: 0.9 } });
  engine.scheduleClick(0, true);
  await engine.playSample(new ArrayBuffer(8));
  const made = ctx.nodes.length;
  const oscillators = ctx.nodes.filter(node => node.kind === 'oscillator');
  const sources = ctx.nodes.filter(node => node.kind === 'source');
  assert.equal(oscillators.length, 5, 'a phaser and a chorus sweep for each bus, and the click');
  assert.equal(sources.length, 1);
  assert.ok(ctx.nodes.some(node => node.connections.includes(ctx.destination)));

  await engine.dispose();
  assert.equal(ctx.state, 'closed');
  assert.ok([...oscillators, ...sources].every(node => node.stopped), 'everything that was sounding is stopped');
  assert.ok(!ctx.nodes.some(node => node.connections.includes(ctx.destination)), 'nothing reaches the output');
  const attached = ctx.nodes.filter(node => node.connections.length > 0);
  assert.ok(attached.every(node => node.kind === 'delay' || node.gain.value === -1), 'only the inside of a chorus is left joined to itself');
  assert.equal(attached.length, 6);
  assert.equal(ctx.nodes.length, made, 'disposing makes nothing');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((synth.input as unknown as Node).connections.length, 0, 'a lane the engine made went with it');
  synth.dispose();
  await engine.dispose();
});

test('a second engine made after the first was disposed shares nothing with it', async () => {
  const first = make();
  first.engine.setMasterVolume(0.25);
  first.engine.setMasterMuted(true);
  first.engine.setEffectsLoop(LOOP);
  first.engine.setEffectsTempo(90);
  const firstLane = first.engine.createLane('synth');
  const firstMaster = masterOf(firstLane);
  await first.engine.loadWorklet();
  await first.engine.dispose();

  const second = make();
  const lane = second.engine.createLane('synth');
  const master = masterOf(lane);
  assert.notEqual(master, firstMaster);
  assert.equal(second.contexts.length, 1);
  assert.equal(first.contexts.length, 1, 'the first engine made nothing more');
  assert.ok(!first.contexts[0].nodes.some(node => second.contexts[0].nodes.includes(node)));
  assert.equal(master.gain.value, MASTER_LEVEL, 'full volume and not muted');
  assert.deepEqual(eqOf(master).map(node => node.gain.value), [0, 0, 0], 'no effects until it is given some');
  assert.ok(!second.contexts[0].nodes.some(node => node.buffer), 'so no reverb impulse either');
  await second.engine.loadWorklet();
  assert.equal(second.contexts[0].modules.length, 1, 'it loads the worklet for itself');
  second.engine.setMasterVolume(0.5);
  assert.equal(firstMaster.gain.value, 0, 'and changing it leaves the first as it was');
  assert.equal(master.gain.value, MASTER_LEVEL * 0.5);
  await second.engine.dispose();
});

test('two engines at once keep their own buses, effects and samples', async () => {
  const a = make(), b = make();
  const laneA = a.engine.createLane('drums'), laneB = b.engine.createLane('drums');
  a.engine.setEffectsLoop(LOOP);
  assert.ok(a.contexts[0].nodes.some(node => node.buffer));
  assert.ok(!b.contexts[0].nodes.some(node => node.buffer));
  await a.engine.playSample(new ArrayBuffer(8));
  await b.engine.playSample(new ArrayBuffer(8));
  const sourceA = a.contexts[0].nodes.find(node => node.kind === 'source')!;
  const sourceB = b.contexts[0].nodes.find(node => node.kind === 'source')!;
  a.engine.stopAllSamples();
  assert.equal(sourceA.stopped, true);
  assert.equal(sourceB.stopped, false);
  await a.engine.dispose();
  assert.equal(b.contexts[0].state, 'running');
  assert.equal((laneB.output as unknown as Node).connections.length, 6, 'the other engine is untouched');
  assert.equal((laneA.output as unknown as Node).connections.length, 0);
  await b.engine.dispose();
});

test('an engine that was disposed makes a new context when it is used again and keeps what it was told', async () => {
  const { engine, contexts } = make();
  engine.setMasterVolume(0.4);
  engine.setEffectsLoop(LOOP);
  engine.createLane('synth');
  await engine.dispose();
  const lane = engine.createLane('synth');
  assert.equal(contexts.length, 2);
  const master = masterOf(lane);
  assert.equal(master.gain.value, MASTER_LEVEL * 0.4);
  assert.deepEqual(eqOf(master).map(node => node.gain.value), [3, -2, 6]);
  assert.ok(contexts[1].nodes.some(node => node.buffer), 'its new bus has the effects it was given');
  await engine.dispose();
});

test('the functions the app calls all reach the one engine', async () => {
  const original = globalThis.AudioContext;
  let made = 0;
  globalThis.AudioContext = class extends Context { constructor() { super(); made++; } } as unknown as typeof AudioContext;
  try {
    setMasterVolume(0.6);
    setEffectsTempo(100);
    setEffectsLoop({ ...LOOP, delay: { ...LOOP.delay, sync: '1/4' } });
    const lane = createAudioLane('synth');
    const ctx = getAudioContext() as unknown as Context;
    assert.equal(audioEngine.getContext(), ctx as unknown as AudioContext);
    assert.equal(made, 1);
    const master = masterOf(lane);
    assert.equal(master.gain.value, MASTER_LEVEL * 0.6);
    audioEngine.setMasterVolume(0.3);
    assert.equal(master.gain.value, MASTER_LEVEL * 0.3, 'the engine and the function set the same master');
    setMasterMuted(true);
    assert.equal(master.gain.value, 0);
    setMasterMuted(false);
    assert.equal(master.gain.value, MASTER_LEVEL * 0.3);
    assert.deepEqual(eqOf(master).map(node => node.gain.value), [3, -2, 6]);
    const delay = ctx.nodes.find(node => node.kind === 'delay' && node.connections.length === 2)!;
    assert.equal(delay.delayTime.value, 0.6, 'a quarter note at the tempo the function set');
    setEffectsTempo(120);
    assert.equal(delay.delayTime.value, 0.5);
    assert.equal(await ensureAudioReady(), true);
    await loadAudioWorklet();
    await audioEngine.loadWorklet();
    assert.equal(ctx.modules.length, 1, 'one worklet load between them');
    const before = ctx.nodes.length;
    scheduleClick(0, false);
    assert.equal(ctx.nodes.length, before + 2);
    assert.ok(ctx.nodes[before + 1].connections.includes(master), 'the click goes to the engine master');
    await playSample(new ArrayBuffer(8));
    const source = ctx.nodes.find(node => node.kind === 'source')!;
    assert.equal(source.connections[0].connections[0], master);
    stopAllSamples();
    assert.equal(source.stopped, true);
    assert.equal(masterOf(audioEngine.createLane('drums')), master);
    assert.equal(made, 1);
    await audioEngine.dispose();
    assert.equal(ctx.state, 'closed');
    assert.equal((lane.input as unknown as Node).connections.length, 0);
  } finally { globalThis.AudioContext = original; }
});
