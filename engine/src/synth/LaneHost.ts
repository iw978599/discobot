import { SynthCore } from './SynthCore';
import { SURGE_VOICE_LIMIT, SurgeVoice, type SurgeModule } from './SurgeVoice';
import type { LanesWorkletEvent, LanesWorkletMessage } from '../workletMessages';

// At most this many lanes play Surge (the owner agreed to two on 2026-11-11): one Surge lane
// cost about 9% of the owner's computer, and five together ran late.
export const MAX_SURGE_LANES = 2;
// Of the time a second of audio may take, the share past which the watchdog acts.
const WATCH_LIMIT = 0.7;
const SHED_TO = 2;

interface Lane {
  core: SynthCore;
  surge?: SurgeVoice;
  // The patch for a Surge engine not made yet, or to load again.
  patch?: Uint8Array;
  // Whether the lane asked for Surge and was refused, so it is told once.
  refused?: boolean;
}

// Every synth lane's voice in one place: what the one `lanes-processor` worklet runs
// (docs/SURGE_XT_PLAN.md, stage 2). Lane N plays into output N - 1. A lane's core is made by the
// first message for it, so a lane that has never been sent anything costs nothing and is silent,
// as a lane with no node of its own was before. A lane whose sound is on Surge also has a
// SurgeVoice, once the page has handed over Surge's module (`useSurge`), which is given the same
// messages and plays while the lane's engine is 'surge'.
export class LaneHost {
  private lanes = new Map<number, Lane>();
  private surgeModule: SurgeModule | null = null;
  private surgeOrder: number[] = [];
  private spent = 0;
  private allowed = 0;
  private scratchLeft = new Float32Array(128);
  private scratchRight = new Float32Array(128);

  constructor(private sampleRate: number, private count: number, private notify: (event: LanesWorkletEvent) => void = () => {}) {}

  // Surge's module, ready: every lane that wants it gets an engine.
  useSurge(module: SurgeModule): void {
    this.surgeModule = module;
    this.lanes.forEach((lane, id) => { if (lane.core.sound.engine === 'surge' || lane.patch) this.makeSurge(id, lane); });
  }

  receive({ lane: id, message }: LanesWorkletMessage): void {
    if (!Number.isInteger(id) || id < 1 || id > this.count) return;
    let lane = this.lanes.get(id);
    if (!lane) this.lanes.set(id, lane = { core: new SynthCore(this.sampleRate) });
    const { core } = lane;
    if (message.type === 'surgePatch') {
      lane.patch = message.bytes;
      if (lane.surge) {
        lane.surge.muted = false;
        lane.surge.setVoiceLimit(SURGE_VOICE_LIMIT);
        lane.surge.loadPatch(message.bytes);
      } else this.makeSurge(id, lane);
      return;
    }
    if (message.type === 'params' && message.params.engine === 'surge' && !lane.surge) this.makeSurge(id, lane);
    const voices: Array<SynthCore | SurgeVoice> = lane.surge ? [core, lane.surge] : [core];
    for (const voice of voices) {
      if (message.type === 'params') voice.setParams(message.params, message.time, message.keep);
      else if (message.type === 'unschedule') voice.clearScheduledParams();
      else if (message.type === 'live') { if (message.bend !== undefined) voice.setBend(message.bend); }
      else if (message.type === 'noteOn') voice.noteOn(message);
      else if (message.type === 'noteOff') voice.noteOff(message.note, message.id);
      else if (message.type === 'allNotesOff') voice.allNotesOff(message.release);
    }
    if (message.type === 'sample') core.setSample(message.sample, message.time);
    else if (message.type === 'live') {
      if (message.wheel !== undefined) core.setWheel(message.wheel);
      if (message.pressure !== undefined) core.setPressure(message.pressure);
    }
  }

  // `frame` is the first frame of the block on the audio context's clock.
  process(frame: number, outputs: Float32Array[][]): void {
    this.lanes.forEach((lane, id) => {
      const output = outputs[id - 1];
      if (!output?.length) return;
      const left = output[0], right = output[1] || output[0];
      lane.core.frame = frame;
      lane.core.process(left, right);
      const surge = lane.surge;
      if (!surge) return;
      if (this.scratchLeft.length !== left.length) { this.scratchLeft = new Float32Array(left.length); this.scratchRight = new Float32Array(left.length); }
      surge.frame = frame;
      surge.process(this.scratchLeft, this.scratchRight);
      if (!surge.playing) return;
      for (let i = 0; i < left.length; i++) { left[i] += this.scratchLeft[i]; if (right !== left) right[i] += this.scratchRight[i]; }
    });
  }

  // How long the last block took to make, in milliseconds, against the `frames` it was. Over each
  // second: past WATCH_LIMIT of the time, every Surge lane is held to fewer notes; once they are
  // at the fewest, the newest Surge lane is muted and the page told, so one lane running late
  // does not make every lane stutter.
  watch(milliseconds: number, frames: number): void {
    this.spent += Math.max(0, milliseconds);
    this.allowed += frames / this.sampleRate * 1000;
    if (this.allowed < 1000 - 1e-6) return;
    const late = this.spent > this.allowed * WATCH_LIMIT;
    this.spent = 0;
    this.allowed = 0;
    const playing = this.surgeOrder.map(id => ({ id, surge: this.lanes.get(id)?.surge })).filter(entry => entry.surge?.playing);
    if (!late || playing.length === 0) return;
    const crowded = playing.filter(entry => entry.surge!.voiceLimit > SHED_TO);
    if (crowded.length) {
      for (const entry of crowded) entry.surge!.setVoiceLimit(Math.max(SHED_TO, Math.floor(entry.surge!.voiceLimit / 2)));
      this.notify({ type: 'surgeShed', lanes: crowded.map(entry => entry.id) });
      return;
    }
    const newest = playing[playing.length - 1];
    newest.surge!.allNotesOff();
    newest.surge!.muted = true;
    this.notify({ type: 'surgeMuted', lane: newest.id });
  }

  private makeSurge(id: number, lane: Lane): void {
    if (lane.surge || !this.surgeModule) return;
    if (this.surgeOrder.length >= MAX_SURGE_LANES) {
      if (!lane.refused) this.notify({ type: 'surgeRefused', lane: id });
      lane.refused = true;
      return;
    }
    try {
      lane.surge = new SurgeVoice(this.surgeModule, this.sampleRate, id, lane.core.sound);
    } catch {
      this.notify({ type: 'surgeFailed', lane: id });
      return;
    }
    lane.surge.frame = lane.core.frame;
    if (lane.patch) lane.surge.loadPatch(lane.patch);
    this.surgeOrder.push(id);
  }
}
