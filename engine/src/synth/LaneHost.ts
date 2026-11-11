import { SynthCore } from './SynthCore';
import type { LanesWorkletMessage } from '../workletMessages';

// Every synth lane's voice in one place: what the one `lanes-processor` worklet runs
// (docs/SURGE_XT_PLAN.md, stage 2). Lane N plays into output N - 1. A lane's core is made by the
// first message for it, so a lane that has never been sent anything costs nothing and is silent,
// as a lane with no node of its own was before.
export class LaneHost {
  private cores = new Map<number, SynthCore>();

  constructor(private sampleRate: number, private lanes: number) {}

  receive({ lane, message }: LanesWorkletMessage): void {
    if (!Number.isInteger(lane) || lane < 1 || lane > this.lanes) return;
    let core = this.cores.get(lane);
    if (!core) this.cores.set(lane, core = new SynthCore(this.sampleRate));
    if (message.type === 'params') core.setParams(message.params, message.time, message.keep);
    else if (message.type === 'unschedule') core.clearScheduledParams();
    else if (message.type === 'sample') core.setSample(message.sample, message.time);
    else if (message.type === 'live') {
      if (message.bend !== undefined) core.setBend(message.bend);
      if (message.wheel !== undefined) core.setWheel(message.wheel);
      if (message.pressure !== undefined) core.setPressure(message.pressure);
    }
    else if (message.type === 'noteOn') core.noteOn(message);
    else if (message.type === 'noteOff') core.noteOff(message.note, message.id);
    else if (message.type === 'allNotesOff') core.allNotesOff(message.release);
  }

  // `frame` is the first frame of the block on the audio context's clock.
  process(frame: number, outputs: Float32Array[][]): void {
    this.cores.forEach((core, lane) => {
      const output = outputs[lane - 1];
      if (!output?.length) return;
      core.frame = frame;
      core.process(output[0], output[1] || output[0]);
    });
  }
}
