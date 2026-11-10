// Runs the packaged worklet in a bare scope like an AudioWorkletGlobalScope (no process, require, crypto,
// performance or TextDecoder), loads a patch, plays three engines and prints what it reported: node worklet-check.mjs <web dir>
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const dir = process.argv[2];
const code = readFileSync(`${dir}/surge-worklet.js`, 'utf8').replace('print() {}, printErr() {},', 'print: (t) => console.log("OUT", t), printErr: (t) => console.log("ERR", t),');
let Processor; const posted = [];
class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }
const scope = { AudioWorkletProcessor, registerProcessor: (name, cls) => { Processor = cls; }, sampleRate: 48000, WebAssembly, console, Date, Math, Float32Array, Uint8Array, Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float64Array, BigInt64Array, BigUint64Array, DataView, ArrayBuffer, Promise, Error, Object, Array, String, Number, BigInt, Symbol, Map, Set, JSON, Reflect, Proxy, TypeError, RangeError, globalThis: null };
scope.globalThis = scope;
vm.createContext(scope);
vm.runInContext(code, scope, { filename: 'surge-worklet.js' });
const module = await WebAssembly.compile(readFileSync(`${dir}/surge-trial.wasm`));
const node = new Processor();
console.log('init'); await node.port.onmessage({ data: { type: 'init', module } }); console.log('ready', JSON.stringify(posted));
const patch = readFileSync(`${dir}/patches/Pads/Bright.fxp`);
await node.port.onmessage({ data: { type: 'patch', bytes: patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.length) } });
await node.port.onmessage({ data: { type: 'on', note: 60 } });
await node.port.onmessage({ data: { type: 'lanes', count: 3 } });
let peak = 0;
for (let i = 0; i < 400; i++) { const out = [[new Float32Array(128), new Float32Array(128)]]; node.process([], out); for (const v of out[0][0]) peak = Math.max(peak, Math.abs(v)); }
console.log(JSON.stringify(posted.filter(m => m.type !== 'load')), 'loads reported', posted.filter(m => m.type === 'load').length, 'peak', peak.toFixed(3));
if (!(peak > 0.01) || !posted.some(m => m.type === 'patch' && m.result === 0)) { console.error('The worklet did not play.'); process.exit(1); }
