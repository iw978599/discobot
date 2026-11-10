// Discobot's own synth on the same notes, for comparison: node --import tsx baseline.ts <out.json>
import { writeFileSync } from 'node:fs';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '../../engine/src/index.ts';

const RATE = 48000, BLOCK = 128, BUDGET_MS = (BLOCK / RATE) * 1000;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
function play(notes: number[], hold: number, tail: number) {
  const core = new SynthCore(RATE);
  core.setParams(toVoiceParams(createDefaultSynthParameters(), 120));
  for (const note of notes) core.noteOn({ note: name(note), velocity: 0.8, duration: hold, time: 0 });
  const frames = Math.round((hold + tail) * RATE), l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  const times: number[] = [];
  for (let at = 0; at < frames; at += BLOCK) { const t = performance.now(); core.process(l, r); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  return { cost: times.reduce((a, b) => a + b, 0) / ((frames / RATE) * 1000), worst: times.at(-1)! / BUDGET_MS };
}
play([48], 1, 1); // warm the JIT
const result = { one: play([48], 1.5, 1.5), eight: play([48, 52, 55, 59, 62, 64, 67, 71], 2, 2) };
writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
console.log(result);
