// The trial's audio worklet: one to five Surge engines ("lanes"), each playing the same notes, so
// the page can show what several Surge lanes would cost. Put after Emscripten's glue
// (createSurgeModule) by the workflow.
const BLOCK = 128;
const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

class SurgeTrial extends AudioWorkletProcessor {
  constructor() {
    super();
    this.M = null;
    this.engines = [];
    this.patch = null;
    this.held = new Set();
    this.spent = 0;
    this.blocks = 0;
    this.worst = 0;
    this.port.onmessage = (event) => this.message(event.data);
  }

  async message(m) {
    if (m.type === 'init') {
      this.M = await createSurgeModule({
        instantiateWasm(imports, done) {
          WebAssembly.instantiate(m.module, imports).then((instance) => done(instance, m.module));
          return {};
        },
        print() {}, printErr() {},
      });
      this.left = this.M._malloc(BLOCK * 4);
      this.right = this.M._malloc(BLOCK * 4);
      this.lanes(1);
      this.port.postMessage({ type: 'ready', block: this.M._surge_block_size() });
    } else if (!this.M) {
      return;
    } else if (m.type === 'patch') {
      this.patch = new Uint8Array(m.bytes);
      const t = clock();
      const results = this.engines.map((engine) => this.load(engine));
      const M = this.M, engine = this.engines[0];
      this.port.postMessage({
        type: 'patch', result: results[0], ms: clock() - t,
        name: M.UTF8ToString(M._surge_patch_name(engine)),
        macros: Array.from({ length: 8 }, (_, i) => M.UTF8ToString(M._surge_macro_name(engine, i))),
      });
    } else if (m.type === 'lanes') {
      this.lanes(m.count);
    } else if (m.type === 'on') {
      this.held.add(m.note);
      for (const engine of this.engines) this.M._surge_note_on(engine, m.note, m.velocity ?? 100);
    } else if (m.type === 'off') {
      this.held.delete(m.note);
      for (const engine of this.engines) this.M._surge_note_off(engine, m.note, 64);
    } else if (m.type === 'macro') {
      for (const engine of this.engines) this.M._surge_set_macro(engine, m.index, m.value);
    }
  }

  load(engine) {
    if (!this.patch) return -1;
    const M = this.M, pointer = M._malloc(this.patch.length);
    M.HEAPU8.set(this.patch, pointer);
    const result = M._surge_load_fxp(engine, pointer, this.patch.length);
    M._free(pointer);
    return result;
  }

  lanes(count) {
    while (this.engines.length > count) this.M._surge_destroy(this.engines.pop());
    while (this.engines.length < count) {
      const engine = this.M._surge_create(sampleRate, 7);
      this.load(engine);
      for (const note of this.held) this.M._surge_note_on(engine, note, 100);
      this.engines.push(engine);
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!this.M || !out || out.length < 2) return true;
    const [l, r] = out;
    const t = clock();
    const scale = 1 / Math.max(1, this.engines.length);
    for (const engine of this.engines) {
      this.M._surge_render(engine, this.left, this.right, l.length);
      const sl = new Float32Array(this.M.HEAPF32.buffer, this.left, l.length);
      const sr = new Float32Array(this.M.HEAPF32.buffer, this.right, l.length);
      for (let i = 0; i < l.length; i++) { l[i] += sl[i] * scale; r[i] += sr[i] * scale; }
    }
    const spent = clock() - t;
    this.spent += spent;
    this.worst = Math.max(this.worst, spent);
    if (++this.blocks >= Math.round(sampleRate / BLOCK)) {
      const budget = (this.blocks * BLOCK / sampleRate) * 1000;
      this.port.postMessage({ type: 'load', share: this.spent / budget, worst: this.worst / ((BLOCK / sampleRate) * 1000), precise: typeof performance !== 'undefined' });
      this.spent = 0; this.blocks = 0; this.worst = 0;
    }
    return true;
  }
}

registerProcessor('surge-trial', SurgeTrial);
