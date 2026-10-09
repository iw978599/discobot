// AudioWorklet entry point. vite.config.ts bundles this file to public/audio-worklet.js;
// the DSP itself lives in the engine so offline export runs exactly the same code.
import { SynthCore } from '../../../engine/src/synth/SynthCore';
import { DrumCore } from '../../../engine/src/drums/DrumCore';

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, processor: new () => WorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type WorkletProcessor = AudioWorkletProcessor & {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

class SynthProcessor extends AudioWorkletProcessor {
  private core = new SynthCore(sampleRate);

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'params') this.core.setParams(data.params);
      else if (data.type === 'noteOn') this.core.noteOn(data);
      else if (data.type === 'noteOff') this.core.noteOff(data.note, data.id);
      else if (data.type === 'allNotesOff') this.core.allNotesOff(data.release);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    this.core.frame = currentFrame;
    this.core.process(output[0], output[1] || output[0]);
    return true;
  }
}

class DrumProcessor extends AudioWorkletProcessor {
  private core = new DrumCore(sampleRate);

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'hit') this.core.trigger(data);
      else if (data.type === 'sample') this.core.setSample(data.instrument, data.sample);
      else if (data.type === 'stopAll') this.core.stopAll();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    this.core.frame = currentFrame;
    this.core.process(output[0], output[1] || output[0]);
    return true;
  }
}

// Plays audio handed over from a guest instrument's frame. Each block arrives with the frame
// on this context's clock at which it should start, so it can be written ahead of time into
// a ring and read out exactly when due.
class GuestPlayer extends AudioWorkletProcessor {
  private size = sampleRate * 2;
  private left = new Float32Array(this.size);
  private right = new Float32Array(this.size);
  // The frame up to which the ring holds audio that has not gone stale.
  private filledTo = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'clear') { this.filledTo = 0; return; }
      const start = Math.round(data.frame), length = data.left.length;
      // Too late to play any of it, or absurdly far ahead: drop it.
      if (start + length <= currentFrame || start > currentFrame + this.size - length) return;
      for (let index = 0; index < length; index++) {
        const frame = start + index;
        if (frame < currentFrame) continue;
        const slot = frame % this.size;
        this.left[slot] = data.left[index];
        this.right[slot] = data.right[index];
      }
      this.filledTo = Math.max(this.filledTo, start + length);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0], right = output[1] || output[0];
    for (let index = 0; index < left.length; index++) {
      const frame = currentFrame + index, slot = frame % this.size;
      if (frame < this.filledTo) { left[index] = this.left[slot]; right[index] = this.right[slot]; }
      // Clear behind the read position so a block that never arrives plays as silence, not as old audio.
      this.left[slot] = 0;
      this.right[slot] = 0;
    }
    return true;
  }
}

registerProcessor('guest-player', GuestPlayer);
registerProcessor('synth-processor', SynthProcessor);
registerProcessor('drum-processor', DrumProcessor);
