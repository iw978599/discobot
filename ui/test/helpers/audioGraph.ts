// A small offline renderer for graphs made of gains, delays, high shelves and a two-channel merger:
// enough of Web Audio to play the Hall reverb's own graph, as `createHallReverb` builds it, and
// measure what comes out. Every signal is one channel. A loop must hold a delay of at least one
// render quantum, as a browser's must; the shelf is the one in the Web Audio specification.
class Param {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
}

export class GraphNode {
  sources: GraphNode[][] = [[], []];
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  type = ''; channelCount = 2; channelCountMode = 'max';
  out = 0;
  constructor(readonly kind: 'gain' | 'delay' | 'filter' | 'merger') {}
  connect(node: GraphNode, _output = 0, input = 0) { node.sources[input].push(this); return node; }
  disconnect() {}
}

export class GraphContext {
  nodes: GraphNode[] = [];
  constructor(readonly sampleRate = 44100) {}
  private node(kind: GraphNode['kind']) { const node = new GraphNode(kind); this.nodes.push(node); return node; }
  createGain = () => { const node = this.node('gain'); node.gain.value = 1; return node; };
  createDelay = () => this.node('delay');
  createBiquadFilter = () => { const node = this.node('filter'); node.frequency.value = 350; return node; };
  createChannelMerger = () => this.node('merger');

  // Plays `signal` into `input` and returns the two channels of `output`, a merger.
  render(input: unknown, output: unknown, signal: Float32Array, frames: number): [Float32Array, Float32Array] {
    const entry = input as GraphNode, merger = output as GraphNode, rate = this.sampleRate;
    const order: GraphNode[] = [], state = new Map<GraphNode, 'open' | 'done'>();
    // A delay of no length (a pre-delay set to nothing) is a plain wire, played in its place in the order.
    const held = (node: GraphNode) => node.kind === 'delay' && node.delayTime.value > 0;
    const visit = (node: GraphNode) => {
      if (held(node) || state.get(node) === 'done') return;
      if (state.get(node) === 'open') throw new Error('a loop with no delay in it');
      state.set(node, 'open');
      node.sources.flat().forEach(visit);
      state.set(node, 'done');
      order.push(node);
    };
    this.nodes.forEach(visit);
    const delays = this.nodes.filter(held).map(node => {
      const length = node.delayTime.value * rate;
      if (Math.abs(length - Math.round(length)) > 1e-3) throw new Error('a delay between frames');
      if (Math.round(length) < 128) throw new Error('a delay shorter than a render quantum');
      return { node, line: new Float32Array(Math.round(length)), at: 0 };
    });
    const filters = new Map(order.filter(node => node.kind === 'filter').map(node => {
      if (node.type !== 'highshelf') throw new Error(`no ${node.type} filter here`);
      const A = Math.pow(10, node.gain.value / 40), w = 2 * Math.PI * node.frequency.value / rate, cos = Math.cos(w);
      const alpha = Math.sin(w) / 2 * Math.SQRT2 * 2 * Math.sqrt(A), a0 = (A + 1) - (A - 1) * cos + alpha;
      return [node, {
        b0: A * ((A + 1) + (A - 1) * cos + alpha) / a0, b1: -2 * A * ((A - 1) + (A + 1) * cos) / a0, b2: A * ((A + 1) + (A - 1) * cos - alpha) / a0,
        a1: 2 * ((A - 1) - (A + 1) * cos) / a0, a2: ((A + 1) - (A - 1) * cos - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0,
      }] as const;
    }));
    const sum = (sources: GraphNode[]) => { let total = 0; for (const source of sources) total += source.out; return total; };
    const left = new Float32Array(frames), right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
      for (const delay of delays) delay.node.out = delay.line[delay.at];
      for (const node of order) {
        const taken = sum(node.sources[0]) + (node === entry ? signal[frame] ?? 0 : 0);
        if (node.kind === 'gain') node.out = taken * node.gain.value;
        else if (node.kind === 'delay') node.out = taken;
        else if (node.kind === 'filter') {
          const f = filters.get(node)!, y = f.b0 * taken + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
          f.x2 = f.x1; f.x1 = taken; f.y2 = f.y1; f.y1 = y;
          node.out = y;
        }
      }
      for (const delay of delays) {
        delay.line[delay.at] = sum(delay.node.sources[0]);
        delay.at = (delay.at + 1) % delay.line.length;
      }
      left[frame] = sum(merger.sources[0]);
      right[frame] = sum(merger.sources[1]);
    }
    return [left, right];
  }
}
