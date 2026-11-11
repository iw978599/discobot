import { finiteClamp as clamp, noteNumber } from '../dsp';
import { InsertChain } from './inserts';
import type { NoteOnMessage } from './SynthCore';
import { createDefaultSynthParameters, toVoiceParams, type VoiceParams } from './voiceParams';

// Surge XT's engine as built for the browser (surge/, docs/SURGE_XT_PLAN.md): the functions of
// its bridge that a lane uses. The worklet and an export each make one module and share it
// between their Surge lanes.
export interface SurgeModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _surge_create(sampleRate: number, seed: number): number;
  _surge_destroy(engine: number): void;
  _surge_load_fxp(engine: number, data: number, size: number): number;
  _surge_note_on(engine: number, key: number, velocity: number): void;
  _surge_note_off(engine: number, key: number, velocity: number): void;
  _surge_all_notes_off(engine: number): void;
  _surge_pitch_bend(engine: number, value: number): void;
  _surge_set_macro(engine: number, index: number, value: number): void;
  _surge_render(engine: number, left: number, right: number, frames: number): void;
  _surge_param_set(engine: number, name: number, text: number): number;
}

// The most notes a Surge lane plays at once, unless the watchdog has lowered it.
export const SURGE_VOICE_LIMIT = 8;
// How long a lane switched away from Surge goes on sounding, for the notes it was letting go of.
const TAIL_SECONDS = 3;
const MACROS = ['surgeMacro1', 'surgeMacro2', 'surgeMacro3', 'surgeMacro4', 'surgeMacro5', 'surgeMacro6', 'surgeMacro7', 'surgeMacro8'] as const;

type Change =
  | { frame: number; kind: 'on'; key: number; velocity: number; serial: number; note: string; id?: number; duration?: number }
  | { frame: number; kind: 'off'; key: number; serial: number }
  | { frame: number; kind: 'params'; update: Partial<VoiceParams>; keep?: boolean }
  | { frame: number; kind: 'patch'; bytes: Uint8Array };

// One lane played by Surge. It takes the messages SynthCore takes, with the same timing: a note or
// a change with a time still to come waits for its sample. It plays only while the lane's engine
// is 'surge', which is itself one of the changes, so a scene that moves a lane on or off Surge
// does so on its first beat. Like SynthCore it applies the lane's level and pan, holds the sum
// below full scale and runs the lane's inserts.
export class SurgeVoice {
  frame = 0;
  // Set by the watchdog: the lane is skipped altogether, and silent.
  muted = false;
  private engine: number;
  private params: VoiceParams = toVoiceParams(createDefaultSynthParameters());
  private changes: Change[] = [];
  private inserts: InsertChain;
  // Which note each key is playing, so a release meant for an earlier note on the same key is ignored.
  private sounding = new Map<number, { serial: number; id?: number; note: string }>();
  private serial = 0;
  private tailUntil = 0;
  private left = 0;
  private right = 0;
  private room = 0;
  private limit = SURGE_VOICE_LIMIT;

  constructor(private M: SurgeModule, private sampleRate: number, seed = 1, sound?: VoiceParams) {
    this.engine = M._surge_create(sampleRate, seed);
    if (!this.engine) throw new Error('Surge could not be made');
    this.inserts = new InsertChain(sampleRate);
    if (sound) this.params = { ...sound };
    this.setVoiceLimit(this.limit);
    this.sendMacros();
  }

  get voiceLimit(): number { return this.limit; }
  get playing(): boolean { return !this.muted && (this.params.engine === 'surge' || this.frame < this.tailUntil); }

  // A whole .fxp file: 0 when loaded, otherwise the bridge's reason (1 not Surge's, 2 cut short, 3 refused).
  loadPatch(bytes: Uint8Array): number {
    const M = this.M, at = M._malloc(Math.max(1, bytes.length));
    M.HEAPU8.set(bytes, at);
    const result = M._surge_load_fxp(this.engine, at, bytes.length);
    M._free(at);
    this.sounding.clear();
    // A patch brings its own voice limit and macros; the lane's stand.
    this.setVoiceLimit(this.limit);
    this.sendMacros();
    return result;
  }

  // A patch from `time` on (a scene with a sound of its own beginning), or now.
  setPatch(bytes: Uint8Array, time?: number): void {
    const frame = this.frameOf(time);
    if (frame > this.frame) this.add({ frame, kind: 'patch', bytes });
    else this.loadPatch(bytes);
  }

  setVoiceLimit(limit: number): void {
    this.limit = Math.max(1, Math.min(SURGE_VOICE_LIMIT, Math.round(limit)));
    const M = this.M, name = this.text('polylimit'), value = this.text(String(this.limit));
    M._surge_param_set(this.engine, name, value);
    M._free(name); M._free(value);
  }

  setParams(update: Partial<VoiceParams> | null | undefined, time?: number, keep = false): void {
    if (!update) return;
    const frame = this.frameOf(time);
    if (frame > this.frame) this.add({ frame, kind: 'params', update, ...(keep ? { keep } : {}) });
    else this.apply(update);
  }

  // Forgets the changes still waiting for their time, keeping the notes. A kept one is made now,
  // and so is a patch waiting, which belongs to a scene's sound as a kept change does.
  clearScheduledParams(): void {
    const kept = this.changes.filter(change => (change.kind === 'params' && change.keep) || change.kind === 'patch');
    this.changes = this.changes.filter(change => change.kind === 'on' || change.kind === 'off');
    for (const change of kept) this.make(change);
  }

  noteOn(message: NoteOnMessage): void {
    const key = noteNumber(message.note), velocity = clamp(message.velocity ?? 1, 0, 1, 1);
    if (key === null || velocity === 0) return;
    const change: Change = {
      frame: this.frameOf(message.time), kind: 'on', key, velocity, serial: ++this.serial, note: message.note,
      ...(message.id !== undefined ? { id: message.id } : {}),
      ...(Number.isFinite(message.duration) ? { duration: message.duration } : {}),
    };
    if (change.frame > this.frame) this.add(change);
    else this.make(change);
  }

  noteOff(note: string, id?: number): void {
    const matches = (entry: { note: string; id?: number }) => entry.note === note && (id === undefined || entry.id === id);
    const dropped = new Set(this.changes.filter(change => change.kind === 'on' && matches(change)).map(change => (change as { serial: number }).serial));
    this.changes = this.changes.filter(change => (change.kind !== 'on' && change.kind !== 'off') || !dropped.has(change.serial));
    for (const [key, playing] of this.sounding) {
      if (!matches(playing)) continue;
      this.M._surge_note_off(this.engine, key, 64);
      this.sounding.delete(key);
    }
  }

  allNotesOff(_release = 0.03): void {
    this.changes = this.changes.filter(change => change.kind !== 'on' && change.kind !== 'off');
    this.sounding.clear();
    this.M._surge_all_notes_off(this.engine);
  }

  setBend(value: number): void {
    this.M._surge_pitch_bend(this.engine, Math.round(clamp(value, -1, 1, 0) * 8191));
  }

  process(left: Float32Array, right: Float32Array): void {
    for (let at = 0; at < left.length;) {
      while (this.changes.length && this.changes[0].frame <= this.frame) this.make(this.changes.shift()!);
      const end = this.changes.length ? Math.min(left.length, at + this.changes[0].frame - this.frame) : left.length;
      this.render(left.subarray(at, end), right.subarray(at, end));
      at = end;
    }
  }

  destroy(): void {
    const M = this.M;
    if (this.left) { M._free(this.left); M._free(this.right); }
    M._surge_destroy(this.engine);
    this.engine = 0;
  }

  private render(left: Float32Array, right: Float32Array): void {
    const frames = left.length;
    if (!this.playing) {
      left.fill(0); right.fill(0);
      this.frame += frames;
      return;
    }
    const M = this.M;
    if (frames > this.room) {
      if (this.left) { M._free(this.left); M._free(this.right); }
      this.room = Math.max(frames, 128);
      this.left = M._malloc(this.room * 4);
      this.right = M._malloc(this.room * 4);
    }
    M._surge_render(this.engine, this.left, this.right, frames);
    // Read after rendering: the module's memory may have grown, which replaces HEAPF32.
    left.set(M.HEAPF32.subarray(this.left >> 2, (this.left >> 2) + frames));
    right.set(M.HEAPF32.subarray(this.right >> 2, (this.right >> 2) + frames));
    // The lane's level and pan, as SynthCore gives a note: equal power, a centred lane at full level.
    const p = this.params, gain = clamp(p.gain, 0, 2, 1);
    const angle = (clamp(p.pan, -1, 1, 0) + 1) * Math.PI / 4;
    const toLeft = gain * Math.cos(angle) * Math.SQRT2, toRight = gain * Math.sin(angle) * Math.SQRT2;
    for (let i = 0; i < frames; i++) {
      left[i] = Math.tanh(left[i] * toLeft);
      right[i] = Math.tanh(right[i] * toRight);
    }
    this.inserts.process(left, right, p);
    this.frame += frames;
  }

  private make(change: Change): void {
    if (change.kind === 'params') { this.apply(change.update); return; }
    if (change.kind === 'patch') { this.loadPatch(change.bytes); return; }
    if (change.kind === 'off') {
      if (this.sounding.get(change.key)?.serial !== change.serial) return;
      this.sounding.delete(change.key);
      this.M._surge_note_off(this.engine, change.key, 64);
      return;
    }
    if (this.params.engine !== 'surge' || this.muted) return;
    this.sounding.set(change.key, { serial: change.serial, note: change.note, ...(change.id !== undefined ? { id: change.id } : {}) });
    this.M._surge_note_on(this.engine, change.key, Math.max(1, Math.round(change.velocity * 127)));
    if (change.duration !== undefined) {
      this.add({ frame: this.frame + Math.max(1, Math.round(change.duration * this.sampleRate)), kind: 'off', key: change.key, serial: change.serial });
    }
  }

  private apply(update: Partial<VoiceParams>): void {
    const p = this.params as unknown as Record<string, unknown>;
    const was = this.params.engine;
    for (const [key, value] of Object.entries(update)) {
      if (!(key in p)) continue;
      const current = p[key];
      if (typeof current === 'number') { if (typeof value === 'number' && Number.isFinite(value)) p[key] = value; }
      else if (typeof current === 'boolean') { if (typeof value === 'boolean') p[key] = value; }
      else if (typeof value === 'string') p[key] = value;
    }
    if (was === 'surge' && this.params.engine !== 'surge') {
      // Off Surge: what is sounding is let go, and rings for a while.
      for (const key of this.sounding.keys()) this.M._surge_note_off(this.engine, key, 64);
      this.sounding.clear();
      this.tailUntil = this.frame + Math.round(TAIL_SECONDS * this.sampleRate);
    }
    if (MACROS.some(name => name in update)) this.sendMacros();
  }

  private sendMacros(): void {
    MACROS.forEach((name, index) => this.M._surge_set_macro(this.engine, index, clamp(this.params[name], 0, 1, 0)));
  }

  private frameOf(time: number | undefined): number {
    return Number.isFinite(time) ? Math.max(this.frame, Math.round(time! * this.sampleRate)) : this.frame;
  }

  // In its place among the changes waiting, after any already there for the same sample.
  private add(change: Change): void {
    let at = this.changes.length;
    while (at > 0 && this.changes[at - 1].frame > change.frame) at--;
    this.changes.splice(at, 0, change);
  }

  // A short ASCII string in the module's memory. An audio worklet may have no TextEncoder.
  private text(value: string): number {
    const at = this.M._malloc(value.length + 1);
    for (let i = 0; i < value.length; i++) this.M.HEAPU8[at + i] = value.charCodeAt(i) & 127;
    this.M.HEAPU8[at + value.length] = 0;
    return at;
  }
}
