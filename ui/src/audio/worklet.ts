// AudioWorklet entry point. vite.config.ts bundles this file to public/audio-worklet.js;
// the DSP itself lives in the engine so offline export runs exactly the same code.
import { LaneHost } from '../../../engine/src/synth/LaneHost';
import { DrumCore } from '../../../engine/src/drums/DrumCore';
import { GUEST_TAP_FRAMES, type DrumWorkletMessage, type GuestPlayerMessage, type GuestTapMessage, type LanesWorkletEvent, type LanesWorkletMessage, type SurgeModuleMessage } from '../../../engine/src/workletMessages';
import type { SurgeModule } from '../../../engine/src/synth/SurgeVoice';

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, processor: new (options: { numberOfOutputs?: number }) => WorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type WorkletProcessor = AudioWorkletProcessor & {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

// Surge's glue (public/surge/surge-worklet.js, loaded into this scope only when a lane first plays
// Surge) leaves this behind.
declare const createSurgeModule: undefined | ((options: Record<string, unknown>) => Promise<SurgeModule>);
// Chrome's audio worklet has no performance; its clock then reads whole milliseconds, which the
// watchdog adds up over a second.
const clock = typeof performance === 'object' ? () => performance.now() : () => Date.now();

// Every synth lane, each into an output of its own (engine/src/synth/LaneHost.ts).
class LanesProcessor extends AudioWorkletProcessor {
  private host: LaneHost;

  constructor(options: { numberOfOutputs?: number }) {
    super();
    const tell = (event: LanesWorkletEvent) => this.port.postMessage(event);
    this.host = new LaneHost(sampleRate, options.numberOfOutputs ?? 1, tell);
    this.port.onmessage = ({ data }: MessageEvent<LanesWorkletMessage | SurgeModuleMessage>) => {
      if ('lane' in data) { this.host.receive(data); return; }
      if (data.type !== 'surgeModule' || typeof createSurgeModule !== 'function') return;
      const module = data.module as WebAssembly.Module;
      createSurgeModule({
        instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
          WebAssembly.instantiate(module, imports).then(instance => done(instance, module));
          return {};
        },
        print() {}, printErr() {},
      }).then(made => { this.host.useSurge(made); tell({ type: 'surgeReady' }); }, () => tell({ type: 'surgeFailed', lane: 0 }));
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const started = clock();
    this.host.process(currentFrame, outputs);
    this.host.watch(clock() - started, outputs[0]?.[0]?.length ?? 128);
    return true;
  }
}

class DrumProcessor extends AudioWorkletProcessor {
  private core = new DrumCore(sampleRate);

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<DrumWorkletMessage>) => {
      if (data.type === 'hit') this.core.trigger(data);
      else if (data.type === 'sample') this.core.setSample(data.instrument, data.sample);
      else if (data.type === 'cymbals') this.core.setCymbals(data.cymbals);
      else if (data.type === 'stopAll') this.core.stopAll();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    this.core.frame = currentFrame;
    // The second and third outputs, when the node has them, are what the drums send to the delay and the reverb.
    this.core.process(output[0], output[1] || output[0], outputs[1], outputs[2]);
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
    this.port.onmessage = ({ data }: MessageEvent<GuestPlayerMessage>) => {
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

// Takes a voice handed to a guest: what reaches it is gathered into blocks and posted to the page,
// silence included, each with the frame it starts on. What it puts out is silence.
class GuestTap extends AudioWorkletProcessor {
  private left = new Float32Array(GUEST_TAP_FRAMES);
  private right = new Float32Array(GUEST_TAP_FRAMES);
  private filled = 0;
  private start = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [], left = input[0], right = input[1] ?? left, length = left?.length ?? 128;
    for (let index = 0; index < length; index++) {
      if (this.filled === 0) this.start = currentFrame + index;
      this.left[this.filled] = left ? left[index] : 0;
      this.right[this.filled] = right ? right[index] : 0;
      if (++this.filled < GUEST_TAP_FRAMES) continue;
      const message: GuestTapMessage = { type: 'block', frame: this.start, left: this.left, right: this.right };
      this.port.postMessage(message, [this.left.buffer, this.right.buffer]);
      this.left = new Float32Array(GUEST_TAP_FRAMES);
      this.right = new Float32Array(GUEST_TAP_FRAMES);
      this.filled = 0;
    }
    return true;
  }
}

registerProcessor('guest-player', GuestPlayer);
registerProcessor('guest-tap', GuestTap);
registerProcessor('lanes-processor', LanesProcessor);
registerProcessor('drum-processor', DrumProcessor);
