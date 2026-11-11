// The one processor for every synth lane (docs/SURGE_XT_PLAN.md, stage 2) must sound exactly as a
// processor for each lane did: the same core, fed the same messages, block by block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneHost } from '../../engine/src/synth/LaneHost.ts';
import { SynthCore } from '../../engine/src/synth/SynthCore.ts';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import type { SynthWorkletMessage } from '../../engine/src/workletMessages.ts';
import { MAX_LANES } from '../src/services/lanes.ts';

const SR = 48000, BLOCK = 128, BLOCKS = 300;

// What each lane is sent, and before which block. Lane 4 is never sent anything.
function script(): Array<{ block: number; lane: number; message: SynthWorkletMessage }> {
  const sound = (lane: number) => {
    const params = createDefaultSynthParameters();
    if (lane === 2) params.engine = 'fm';
    if (lane === 5) { params.unison = { voices: 3, detune: 0.3 }; params.spread = 0.8; }
    return toVoiceParams(params, 120);
  };
  const at = (block: number) => (block * BLOCK + 37) / SR;
  return [
    { block: 0, lane: 1, message: { type: 'params', params: sound(1) } },
    { block: 0, lane: 2, message: { type: 'params', params: sound(2) } },
    { block: 0, lane: 5, message: { type: 'params', params: sound(5) } },
    { block: 0, lane: 1, message: { type: 'noteOn', note: 'C4', velocity: 0.8, id: 1, time: at(3) } },
    { block: 0, lane: 1, message: { type: 'noteOn', note: 'E4', velocity: 0.6, id: 2, duration: 0.5, time: at(10) } },
    { block: 2, lane: 2, message: { type: 'noteOn', note: 'G2', velocity: 1, id: 3 } },
    { block: 5, lane: 5, message: { type: 'noteOn', note: 'A3', velocity: 0.9, id: 4, time: at(6) } },
    { block: 20, lane: 2, message: { type: 'params', params: { oscType: 'square', subLevel: 0.7 }, time: at(40) } },
    { block: 30, lane: 5, message: { type: 'live', bend: 0.5, wheel: 0.3 } },
    { block: 60, lane: 1, message: { type: 'noteOff', note: 'C4' } },
    { block: 80, lane: 2, message: { type: 'unschedule' } },
    { block: 120, lane: 5, message: { type: 'allNotesOff', release: 0.1 } },
    { block: 150, lane: 2, message: { type: 'noteOff', note: 'G2', id: 3 } },
  ];
}

// The old way: a core for each lane, run on its own.
function separately(): Map<number, Float32Array[]> {
  const cores = new Map<number, SynthCore>(), out = new Map<number, Float32Array[]>(), steps = script();
  for (let block = 0; block < BLOCKS; block++) {
    for (const { lane, message } of steps.filter(step => step.block === block)) {
      let core = cores.get(lane);
      if (!core) cores.set(lane, core = new SynthCore(SR));
      if (message.type === 'params') core.setParams(message.params, message.time, message.keep);
      else if (message.type === 'unschedule') core.clearScheduledParams();
      else if (message.type === 'live') { if (message.bend !== undefined) core.setBend(message.bend); if (message.wheel !== undefined) core.setWheel(message.wheel); }
      else if (message.type === 'noteOn') core.noteOn(message);
      else if (message.type === 'noteOff') core.noteOff(message.note, message.id);
      else if (message.type === 'allNotesOff') core.allNotesOff(message.release);
    }
    cores.forEach((core, lane) => {
      if (!out.has(lane)) out.set(lane, [new Float32Array(BLOCK * BLOCKS), new Float32Array(BLOCK * BLOCKS)]);
      const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
      core.frame = block * BLOCK;
      core.process(left, right);
      out.get(lane)![0].set(left, block * BLOCK);
      out.get(lane)![1].set(right, block * BLOCK);
    });
  }
  return out;
}

// The new way: one host, an output for each of the five lanes.
function together(): Float32Array[][] {
  const host = new LaneHost(SR, MAX_LANES), steps = script();
  const out = Array.from({ length: MAX_LANES }, () => [new Float32Array(BLOCK * BLOCKS), new Float32Array(BLOCK * BLOCKS)]);
  for (let block = 0; block < BLOCKS; block++) {
    for (const { lane, message } of steps.filter(step => step.block === block)) host.receive({ lane, message });
    const outputs = Array.from({ length: MAX_LANES }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)]);
    host.process(block * BLOCK, outputs);
    outputs.forEach(([left, right], index) => { out[index][0].set(left, block * BLOCK); out[index][1].set(right, block * BLOCK); });
  }
  return out;
}

test('every lane sounds through the one processor exactly as through a processor of its own', () => {
  const old = separately(), now = together();
  for (const lane of [1, 2, 5]) {
    const [left, right] = old.get(lane)!;
    assert.ok(left.some(value => value !== 0), `lane ${lane} makes sound`);
    assert.deepEqual(now[lane - 1][0], left, `lane ${lane} left`);
    assert.deepEqual(now[lane - 1][1], right, `lane ${lane} right`);
  }
  for (const lane of [3, 4]) assert.ok(now[lane - 1][0].every(value => value === 0), `lane ${lane} is silent`);
});

test('a message for a lane that cannot exist is ignored', () => {
  const host = new LaneHost(SR, MAX_LANES);
  for (const lane of [0, 6, 1.5, Number.NaN]) host.receive({ lane, message: { type: 'noteOn', note: 'C4', velocity: 1 } });
  const outputs = Array.from({ length: MAX_LANES }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)]);
  host.process(0, outputs);
  assert.ok(outputs.every(([left]) => left.every(value => value === 0)));
});
