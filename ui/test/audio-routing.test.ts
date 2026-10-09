import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_LEVEL, createAudioLane, getAudioContext, loadAudioWorklet, setEffectsLoop, setMasterMuted, setMasterVolume } from '../src/hooks/browserAudio';
import type { EffectsLoopState } from '../src/types';

class Param {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
}
class Node {
  connections: Node[] = [];
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  curve?: Float32Array; oversample?: string; buffer?: unknown; type?: string; channelCount?: number; channelCountMode?: string;
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect(target?: Node) { this.connections = target ? this.connections.filter(node => node !== target) : []; }
  start() {}
}
class Context {
  static instances = 0;
  sampleRate = 1000; currentTime = 0; state = 'running'; destination = new Node();
  modules: string[] = [];
  nodes: Node[] = [];
  audioWorklet = { addModule: async (url: string) => { this.modules.push(url); } };
  constructor() { Context.instances++; }
  resume = async () => { this.state = 'running'; };
  createGain = () => { const node = this.node(); node.gain.value = 1; return node; };
  createDynamicsCompressor = () => this.node();
  createWaveShaper = () => this.node();
  createDelay = () => this.node();
  createConvolver = () => this.node();
  createBiquadFilter = () => this.node();
  createOscillator = () => this.node();
  createChannelMerger = () => this.node();
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel] };
  }
  private node() { const node = new Node(); this.nodes.push(node); return node; }
}

test('synth and drums share one protected destination and independent parallel FX sends', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  try {
    setMasterVolume(0.8);
    const synth = createAudioLane('synth'), drums = createAudioLane('drums');
    const ctx = getAudioContext() as unknown as Context;
    assert.equal(Context.instances, 1);
    const master = (synth.output as unknown as Node).connections[0];
    assert.deepEqual((synth.input as unknown as Node).connections, [synth.output], 'lane volume feeds the ducker and nothing else');
    assert.equal((drums.output as unknown as Node).connections[0], master);
    assert.equal(master.gain.value, MASTER_LEVEL * 0.8);
    const destinationInputs = ctx.nodes.filter(node => node.connections.includes(ctx.destination));
    assert.equal(destinationInputs.length, 1, 'only the final safety shaper reaches the destination');
    assert.ok(destinationInputs[0].curve);
    const eq = [master.connections[0], master.connections[0].connections[0], master.connections[0].connections[0].connections[0]];
    assert.deepEqual(eq.map(node => node.type), ['lowshelf', 'peaking', 'highshelf'], 'the master EQ sits between the mix and the limiter');
    assert.deepEqual(eq.map(node => node.gain.value), [0, 0, 0], 'and is flat until it is set');
    const limiter = eq[2].connections[0];
    assert.equal(limiter.ratio.value, 20, 'master has a limiter');
    assert.ok(limiter.threshold.value >= -3, 'the limiter only catches peaks, so drums do not duck each other');
    assert.equal(master.connections.length, 1, 'no dry bypass around limiter');
    assert.deepEqual(eq.map(node => node.connections.length), [1, 1, 1]);
    assert.equal((synth.output as unknown as Node).connections.length, 6, 'dry plus five parallel sends');
    synth.duck(0, 0.5);
    assert.equal((synth.output as unknown as Node).gain.value, 1, 'a duck dips and then returns to full level');
    assert.equal((drums.output as unknown as Node).gain.value, 1);

    synth.setSends({ reverb: 0.1, delay: 0.2, drive: 0.3, phaser: 0.4, chorus: 0.6 }, 0.5);
    // A lane saved before the chorus existed has no send for it.
    drums.setSends({ reverb: 0.8, delay: 0.7, drive: 0.6, phaser: 0.5 }, 1);
    const synthSends = (synth.output as unknown as Node).connections.slice(1);
    const drumSends = (drums.output as unknown as Node).connections.slice(1);
    assert.deepEqual(synthSends.map(node => node.gain.value), [0.05, 0.1, 0.15, 0.2, 0.3]);
    assert.deepEqual(drumSends.map(node => node.gain.value), [0.8, 0.7, 0.6, 0.5, 0]);
    const loop: EffectsLoopState = {
      enabled: true, returns: { synth: 0.7, drums: 0.6 },
      drive: { enabled: true, amount: 0.5, tone: 0.25 },
      delay: { enabled: true, time: 0.3, feedback: 10, mix: 0.8 },
      reverb: { enabled: true, decay: 1, mix: 0.7 },
      phaser: { enabled: true, rate: 0.5, depth: 0.5, feedback: 10, mix: 0.6 },
      chorus: { enabled: true, rate: 0.9, depth: 0.5, mix: 0.55 },
      eq: { enabled: true, low: 3, mid: -40, high: 6 },
    };
    setEffectsLoop(loop);
    assert.deepEqual(eq.map(node => node.gain.value), [3, -12, 6], 'EQ bands are set and bounded');
    assert.ok(ctx.nodes.some(node => node.type === 'triangle' && node.frequency.value === 0.9), 'the chorus sweeps at its rate');
    assert.ok(ctx.nodes.some(node => node.gain.value === 0.55), 'and returns at its mix');
    setEffectsLoop({ ...loop, enabled: false, eq: { ...loop.eq!, enabled: false } });
    assert.deepEqual(eq.map(node => node.gain.value), [0, 0, 0], 'an EQ switched off is flat');
    setEffectsLoop(loop);
    assert.ok(ctx.nodes.some(node => node.gain.value === 0.85), 'delay feedback safely bounded');
    assert.ok(ctx.nodes.some(node => node.gain.value === 0.75), 'phaser feedback safely bounded');
    assert.ok(ctx.nodes.some(node => node.frequency.value === 400 * Math.pow(40, 0.25)), 'drive tone is connected and controlled');
    assert.ok(ctx.nodes.some(node => node.buffer), 'reverb receives an impulse');
    const effectReturns = ctx.nodes.filter(node => node !== synth.output && node !== drums.output && node.connections.includes(master));
    assert.deepEqual(effectReturns.map(node => node.gain.value), [0.7, 0.6]);
    const oldReverbs = ctx.nodes.filter(node => node.buffer);
    const oldDrives = ctx.nodes.filter(node => node.curve && node !== destinationInputs[0]);
    setEffectsLoop({ ...loop, reverb: { ...loop.reverb, decay: 1.5 }, drive: { ...loop.drive, amount: 0.7 } });
    assert.ok(oldReverbs.every(node => node.connections[0].gain.value === 0), 'old reverb fades out instead of replacing its impulse abruptly');
    assert.ok(oldDrives.every(node => node.connections[0].gain.value === 0), 'old drive curve fades out');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok([...oldReverbs, ...oldDrives].every(node => node.connections.length === 0), 'crossfaded processors are released');
    setEffectsLoop({ ...loop, enabled: false });
    assert.ok(effectReturns.every(node => node.gain.value === 0), 'global bypass silences only returns, not dry audio');
    assert.equal((synth.input as unknown as Node).gain.value, 1);
    synth.setVolume(0.4);
    assert.equal((synth.input as unknown as Node).gain.value, 0.4);
    setMasterMuted(true); assert.equal(master.gain.value, 0);
    setMasterMuted(false); assert.equal(master.gain.value, MASTER_LEVEL * 0.8);
    await Promise.all([loadAudioWorklet(), loadAudioWorklet()]);
    assert.equal(ctx.modules.length, 1, 'concurrent lanes load one module');
    synth.dispose(); drums.dispose();
    assert.equal((synth.input as unknown as Node).connections.length, 0);
    assert.equal(Context.instances, 1);
  } finally { globalThis.AudioContext = original; }
});
