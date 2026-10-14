// A small offline renderer for graphs made of gains, delays, high shelves and a two-channel merger:
// enough of Web Audio to play the Hall reverb's own graph, as `createHallReverb` builds it, and
// measure what comes out. Every signal is one channel. It renders the way Chrome was seen to on
// the check machines (the probe in pull request 188): a block of 128 frames at a time, each node
// pulling its inputs in turn, and a node pulled again while it is still working answering with
// the block it made last time. So every loop is one block longer than its delays, and a graph
// whose answer depends on the order inputs are pulled in is caught: `render` takes that order.
const QUANTUM = 128;
class Param {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
}

export class GraphNode {
  sources: GraphNode[][] = [[], []];
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  type = ''; channelCount = 2; channelCountMode = 'max';
  constructor(readonly kind: 'gain' | 'delay' | 'filter' | 'merger') {}
  connect(node: GraphNode, _output = 0, input = 0) { node.sources[input].push(this); return node; }
  disconnect() {}
}

type Shelf = { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number };

export class GraphContext {
  nodes: GraphNode[] = [];
  constructor(readonly sampleRate = 44100) {}
  private node(kind: GraphNode['kind']) { const node = new GraphNode(kind); this.nodes.push(node); return node; }
  createGain = () => { const node = this.node('gain'); node.gain.value = 1; return node; };
  createDelay = () => this.node('delay');
  createBiquadFilter = () => { const node = this.node('filter'); node.frequency.value = 350; return node; };
  createChannelMerger = () => this.node('merger');

  // Plays `signal` into `input` and returns the two channels of `output`, a merger. With
  // `reversed`, every node pulls its inputs last first.
  render(input: unknown, output: unknown, signal: Float32Array, frames: number, reversed = false): [Float32Array, Float32Array] {
    const entry = input as GraphNode, merger = output as GraphNode, rate = this.sampleRate;
    const lines = new Map<GraphNode, { line: Float32Array; length: number; at: number }>();
    const shelves = new Map<GraphNode, Shelf>();
    for (const node of this.nodes) {
      if (node.kind === 'delay') {
        const length = node.delayTime.value * rate;
        if (Math.abs(length - Math.round(length)) > 1e-3) throw new Error('a delay between frames');
        lines.set(node, { line: new Float32Array(Math.round(length) + QUANTUM), length: Math.round(length), at: 0 });
      }
      if (node.kind === 'filter') {
        if (node.type !== 'highshelf') throw new Error(`no ${node.type} filter here`);
        const A = Math.pow(10, node.gain.value / 40), w = 2 * Math.PI * node.frequency.value / rate, cos = Math.cos(w);
        const alpha = Math.sin(w) / 2 * Math.SQRT2 * 2 * Math.sqrt(A), a0 = (A + 1) - (A - 1) * cos + alpha;
        shelves.set(node, {
          b0: A * ((A + 1) + (A - 1) * cos + alpha) / a0, b1: -2 * A * ((A - 1) + (A + 1) * cos) / a0, b2: A * ((A + 1) + (A - 1) * cos - alpha) / a0,
          a1: 2 * ((A - 1) - (A + 1) * cos) / a0, a2: ((A + 1) - (A - 1) * cos - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0,
        });
      }
    }
    const made = new Map<GraphNode, Float32Array>(), working = new Set<GraphNode>(), done = new Set<GraphNode>();
    const silence = new Float32Array(QUANTUM);
    let block = 0;
    const sum = (sources: GraphNode[]) => {
      const total = new Float32Array(QUANTUM);
      for (const source of reversed ? [...sources].reverse() : sources) {
        const part = pull(source);
        for (let i = 0; i < QUANTUM; i++) total[i] += part[i];
      }
      return total;
    };
    const pull = (node: GraphNode): Float32Array => {
      if (done.has(node)) return made.get(node)!;
      if (working.has(node)) return made.get(node) ?? silence;
      working.add(node);
      const taken = sum(node.sources[0]);
      if (node === entry) for (let i = 0; i < QUANTUM; i++) taken[i] += signal[block * QUANTUM + i] ?? 0;
      const out = new Float32Array(QUANTUM);
      if (node.kind === 'gain') for (let i = 0; i < QUANTUM; i++) out[i] = taken[i] * node.gain.value;
      else if (node.kind === 'delay') {
        const d = lines.get(node)!;
        for (let i = 0; i < QUANTUM; i++) {
          d.line[d.at] = taken[i];
          out[i] = d.line[(d.at - d.length + d.line.length) % d.line.length];
          d.at = (d.at + 1) % d.line.length;
        }
      } else if (node.kind === 'filter') {
        const f = shelves.get(node)!;
        for (let i = 0; i < QUANTUM; i++) {
          const y = f.b0 * taken[i] + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
          f.x2 = f.x1; f.x1 = taken[i]; f.y2 = f.y1; f.y1 = y;
          out[i] = y;
        }
      }
      working.delete(node);
      done.add(node);
      made.set(node, out);
      return out;
    };
    const left = new Float32Array(frames), right = new Float32Array(frames);
    for (block = 0; block * QUANTUM < frames; block++) {
      done.clear();
      const sides = reversed ? [1, 0] : [0, 1];
      const outs = sides.map(side => sum(merger.sources[side]));
      const [l, r] = reversed ? [outs[1], outs[0]] : outs;
      left.set(l.subarray(0, Math.min(QUANTUM, frames - block * QUANTUM)), block * QUANTUM);
      right.set(r.subarray(0, Math.min(QUANTUM, frames - block * QUANTUM)), block * QUANTUM);
    }
    return [left, right];
  }
}
