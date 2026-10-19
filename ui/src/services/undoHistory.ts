import { OP_META, type Operation } from './projectOps';

// Undo for the whole project, kept by the store. Before an edit that can be undone, the store asks
// whether it begins a step of its own or belongs to the one already open, and for a new step hands
// over the project as it was, as text. A step is:
// - every edit made in one turn (a pattern tool's dozens of edits, a starting beat);
// - a run of changes to one control, each within `UNDO_GAP_MS` of the one before (a knob turned,
//   a fader dragged): measured from the last change, not from the step's start;
// - everything made while a group is held open, for an action spread over several turns (a pass
//   of Auto recording, a MIDI import).
export const UNDO_GAP_MS = 300;
export const MAX_UNDO = 80;
// Steps are whole projects. Past this much text the oldest are let go, however few there are.
const MAX_UNDO_CHARS = 40_000_000;

// The control an edit moves, for edits that come in runs; null for one that is a step of its own.
export function undoRun(op: Operation): string | null {
  switch (op.type) {
    case 'tempo.set': case 'drum.swing': case 'drum.masterVolume': case 'drum.fx': case 'effects.set':
      return op.type;
    // A macro, a model and a preset change the sound in two edits a turn apart: one run.
    case 'synth.params': case 'synth.model': return `synth:${op.synthId}`;
    case 'drum.settings': return `${op.type}:${op.instrument}`;
    case 'drum.stepVelocity': case 'drum.stepDetail': return `${op.type}:${op.instrument}:${op.step}`;
    default: return null;
  }
}

export class UndoHistory {
  private undo: string[] = [];
  private redo: string[] = [];
  private run: { key: string; at: number } | null = null;
  private turn = false;
  private named: string | null = null;
  private groups = new Set<string>();
  private grouped = false;
  // Called through a function of its own: a browser refuses `queueMicrotask` called as a method.
  constructor(private later: (task: () => void) => void = task => queueMicrotask(task)) {}

  private key(op: Operation) { return undoRun(op) ?? this.named; }

  // Whether this edit begins a new step, so the project must be handed over first.
  opens(op: Operation, now: number): boolean {
    if (!OP_META[op.type].undoable) return false;
    if (this.turn || (this.groups.size > 0 && this.grouped)) return false;
    const key = this.key(op);
    return !(key !== null && this.run?.key === key && now - this.run.at < UNDO_GAP_MS);
  }

  // After the edit was accepted. `before` is the project as it was when `opens` said so.
  record(op: Operation, now: number, before: string | null) {
    if (!OP_META[op.type].undoable) return;
    const key = this.key(op);
    this.run = key === null ? null : { key, at: now };
    if (!this.turn) { this.turn = true; this.later(() => { this.turn = false; }); }
    if (this.groups.size > 0) this.grouped = true;
    if (before === null) return;
    this.redo = [];
    // The edits since the last step changed nothing: that step would undo nothing.
    if (this.undo[this.undo.length - 1] === before) return;
    this.undo.push(before);
    this.trim();
  }

  // The edits in this turn that are not a run by their own kind (a pattern written as a velocity
  // is dragged) belong to the run named `key`.
  runAs(key: string) {
    this.named = key;
    this.later(() => { this.named = null; });
  }

  // While any group is open, every edit belongs to the step the first of them began.
  hold(name: string, open: boolean) {
    if (open) {
      if (this.groups.size === 0) this.grouped = false;
      this.groups.add(name);
    } else this.groups.delete(name);
  }

  // The project to put back, with the project as it is now kept for the other direction; null when
  // there is none. `current` is handed the step about to be put back and answers the project now:
  // the store opens that step's scene first, so what is kept for the other direction is in the
  // scene the step was made in. A step that would put back what is already there is passed over.
  step(direction: 'undo' | 'redo', current: (target: string) => string): string | null {
    const from = direction === 'undo' ? this.undo : this.redo, to = direction === 'undo' ? this.redo : this.undo;
    let target = from.pop(), now = target === undefined ? '' : current(target);
    while (target !== undefined && target === now) {
      target = from.pop();
      if (target !== undefined) now = current(target);
    }
    if (target === undefined) return null;
    to.push(now);
    this.trim();
    // The next edit begins a step of its own, whatever it is.
    this.run = null;
    this.turn = false;
    this.grouped = false;
    return target;
  }

  clear() {
    this.undo = [];
    this.redo = [];
    this.run = null;
    this.groups.clear();
  }

  get size() { return { undo: this.undo.length, redo: this.redo.length }; }

  private trim() {
    for (const list of [this.undo, this.redo]) {
      let chars = list.reduce((sum, entry) => sum + entry.length, 0);
      while (list.length > 1 && (list.length > MAX_UNDO || chars > MAX_UNDO_CHARS)) chars -= list.shift()!.length;
    }
  }
}
