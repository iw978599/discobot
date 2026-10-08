import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioLane, getAudioContext, loadSynthWorklet, setEffectsLoop, setMasterMuted, setMasterVolume } from '../src/hooks/browserAudio';
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
  curve?: Float32Array; oversample?: string; buffer?: unknown; type?: string;
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
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
    const master = (synth.input as unknown as Node).connections[0];
    assert.equal((drums.input as unknown as Node).connections[0], master);
    assert.equal(master.gain.value, 0.55 * 0.8);
    const destinationInputs = ctx.nodes.filter(node => node.connections.includes(ctx.destination));
    assert.equal(destinationInputs.length, 1, 'only the final safety shaper reaches the destination');
    assert.ok(destinationInputs[0].curve);
    assert.equal(master.connections[0].ratio.value, 20, 'master has a limiter');
    assert.equal(master.connections.length, 1, 'no dry bypass around limiter');
    assert.equal((synth.input as unknown as Node).connections.length, 5, 'dry plus four parallel sends');

    synth.setSends({ reverb: 0.1, delay: 0.2, drive: 0.3, phaser: 0.4 }, 0.5);
    drums.setSends({ reverb: 0.8, delay: 0.7, drive: 0.6, phaser: 0.5 }, 1);
    const synthSends = (synth.input as unknown as Node).connections.slice(1);
    const drumSends = (drums.input as unknown as Node).connections.slice(1);
    assert.deepEqual(synthSends.map(node => node.gain.value), [0.05, 0.1, 0.15, 0.2]);
    assert.deepEqual(drumSends.map(node => node.gain.value), [0.8, 0.7, 0.6, 0.5]);
    const loop: EffectsLoopState = {
      enabled: true, returns: { synth: 0.7, drums: 0.6 },
      drive: { enabled: true, amount: 0.5, tone: 0.25 },
      delay: { enabled: true, time: 0.3, feedback: 10, mix: 0.8 },
      reverb: { enabled: true, decay: 1, mix: 0.7 },
      phaser: { enabled: true, rate: 0.5, depth: 0.5, feedback: 10, mix: 0.6 },
    };
    setEffectsLoop(loop);
    assert.ok(ctx.nodes.some(node => node.gain.value === 0.85), 'delay feedback safely bounded');
    assert.ok(ctx.nodes.some(node => node.gain.value === 0.75), 'phaser feedback safely bounded');
    assert.ok(ctx.nodes.some(node => node.frequency.value === 400 * Math.pow(40, 0.25)), 'drive tone is connected and controlled');
    assert.ok(ctx.nodes.some(node => node.buffer), 'reverb receives an impulse');
    const effectReturns = ctx.nodes.filter(node => node !== synth.input && node !== drums.input && node.connections.includes(master));
    assert.deepEqual(effectReturns.map(node => node.gain.value), [0.7, 0.6]);
    setEffectsLoop({ ...loop, enabled: false });
    assert.ok(effectReturns.every(node => node.gain.value === 0), 'global bypass silences only returns, not dry audio');
    assert.equal((synth.input as unknown as Node).gain.value, 1);
    synth.setVolume(0.4);
    assert.equal((synth.input as unknown as Node).gain.value, 0.4);
    setMasterMuted(true); assert.equal(master.gain.value, 0);
    setMasterMuted(false); assert.equal(master.gain.value, 0.55 * 0.8);
    await Promise.all([loadSynthWorklet(), loadSynthWorklet()]);
    assert.equal(ctx.modules.length, 1, 'concurrent lanes load one module');
    synth.dispose(); drums.dispose();
    assert.equal((synth.input as unknown as Node).connections.length, 0);
    assert.equal(Context.instances, 1);
  } finally { globalThis.AudioContext = original; }
});
