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

registerProcessor('synth-processor', SynthProcessor);
registerProcessor('drum-processor', DrumProcessor);
