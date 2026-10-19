// What makes an undo step: `UndoHistory` on its own, with the turns and the clock in the test's
// hands, then undo through a real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UNDO, UNDO_GAP_MS, UndoHistory, undoRun } from '../src/services/undoHistory.ts';
import type { Operation } from '../src/services/projectOps.ts';
import { ok, setup } from './helpers/store.ts';

// A history whose turns end when the test says so.
function history() {
  let pending: Array<() => void> = [];
  const h = new UndoHistory(task => { pending.push(task); });
  const endTurn = () => { const run = pending; pending = []; run.forEach(task => task()); };
  let project = 0;
  // An edit: the project as it was is handed over only when the edit begins a step.
  const edit = (op: Operation, now: number) => {
    const before = h.opens(op, now) ? `p${project}` : null;
    project++;
    h.record(op, now, before);
  };
  return { h, endTurn, edit, current: () => `p${project}` };
}
const tempo: Operation = { type: 'tempo.set', tempo: 120 };
const note: Operation = { type: 'pattern.write', synthId: 1, patternId: 'a', patch: {} };
const cell: Operation = { type: 'drum.step', instrument: 'kick', step: 0, active: true };

test('every edit in one turn is one step, and the next turn begins another', () => {
  const { h, endTurn, edit } = history();
  edit(note, 0); edit(cell, 0); edit(note, 0);
  assert.equal(h.size.undo, 1);
  endTurn();
  edit(cell, 1);
  assert.equal(h.size.undo, 2);
});

test('a run of changes to one control is one step while each comes within the gap of the last', () => {
  const { h, endTurn, edit } = history();
  // The first change begins a step even at the clock's zero, a moment after the page loaded.
  edit(tempo, 0); endTurn();
  for (let at = 200; at <= 1200; at += 200) { edit(tempo, at); endTurn(); }
  assert.equal(h.size.undo, 1, 'measured from the last change, not from the step\'s start');
  edit(tempo, 1200 + UNDO_GAP_MS); endTurn();
  assert.equal(h.size.undo, 2, 'a pause begins another');
  edit({ type: 'drum.swing', swing: 0.2 }, 1600 + UNDO_GAP_MS); endTurn();
  assert.equal(h.size.undo, 3, 'and so does another control');
  edit(note, 1700 + UNDO_GAP_MS); endTurn(); edit(note, 1750 + UNDO_GAP_MS); endTurn();
  assert.equal(h.size.undo, 5, 'a note is a step of its own however soon it follows');
});

test('the controls a run is kept by', () => {
  assert.equal(undoRun({ type: 'synth.params', synthId: 2, patch: {} }), undoRun({ type: 'synth.model', synthId: 2 }), 'a macro\'s two edits');
  assert.notEqual(undoRun({ type: 'synth.params', synthId: 2, patch: {} }), undoRun({ type: 'synth.params', synthId: 1, patch: {} }));
  assert.notEqual(undoRun({ type: 'drum.settings', instrument: 'kick', settings: {} }), undoRun({ type: 'drum.settings', instrument: 'snare', settings: {} }));
  assert.equal(undoRun(note), null);
  assert.equal(undoRun(cell), null);
});

test('a named run makes a pattern written many times one step, as a dragged velocity is', () => {
  const { h, endTurn, edit } = history();
  for (let at = 0; at < 600; at += 100) { h.runAs('velocity:3'); edit(note, at); endTurn(); }
  assert.equal(h.size.undo, 1);
});

test('a held group is one step across turns and pauses, and the step after it is its own', () => {
  const { h, endTurn, edit } = history();
  h.hold('auto', true);
  edit(note, 0); endTurn(); edit(note, 5000); endTurn(); edit(tempo, 9000); endTurn();
  h.hold('auto', false);
  assert.equal(h.size.undo, 1);
  edit(note, 9100);
  assert.equal(h.size.undo, 2);
});

test('edits that undo cannot take back begin no step', () => {
  const { h, edit } = history();
  edit({ type: 'scene.select', sceneId: 'b' }, 0);
  edit({ type: 'synth.prefs', synthId: 1, octaveShift: 1 }, 0);
  edit({ type: 'guest.patch', guestId: 'g', patch: {} }, 0);
  edit({ type: 'transport.play', synthId: 1 }, 0);
  assert.equal(h.size.undo, 0);
});

test('undo and redo trade the project, pass over steps that change nothing, and a new edit forgets redo', () => {
  const { h, endTurn, edit, current } = history();
  edit(note, 0); endTurn(); edit(note, 1); endTurn();
  assert.equal(h.step('undo', current), 'p1');
  assert.equal(h.step('undo', () => 'p1'), 'p0');
  assert.equal(h.step('undo', () => 'p0'), null, 'nothing further back');
  assert.equal(h.step('redo', () => 'p0'), 'p1');
  assert.equal(h.size.redo, 1);
  edit(cell, 2);
  assert.equal(h.size.redo, 0);
  // A step whose project is the one already there is passed over.
  const same = new UndoHistory(() => {});
  same.record(note, 0, 'x');
  assert.equal(same.step('undo', () => 'x'), null);
});

test('only the newest steps are kept', () => {
  const { h, endTurn, edit } = history();
  for (let i = 0; i < MAX_UNDO + 5; i++) { edit(note, i); endTurn(); }
  assert.equal(h.size.undo, MAX_UNDO);
});

// Through the store: a step puts back the whole project.
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('the store records each edit, and undo puts the whole project back, one step at a time', async () => {
  const service = setup();
  const lane = service.snapshot().synths[0];
  const { tempo } = service.getTempo();
  ok(service.setDrumStep('kick', 0, true));
  ok(service.writePattern(lane.synthId, lane.pattern.id, { steps: lane.pattern.steps.map((step: any, i: number) => (i === 0 ? { ...step, active: true, note: 'C3' } : step)) }));
  await turn();
  ok(service.setTempo(tempo + 20));
  await turn();
  const events: string[] = [];
  service.subscribe(message => events.push(message.type));
  assert.equal(service.undo(), true);
  assert.equal(service.getTempo().tempo, tempo);
  assert.equal(service.snapshot().synths[0].pattern.steps[0].active, true, 'the step before is still there');
  assert.equal(service.undo(), true);
  assert.equal(service.snapshot().synths[0].pattern.steps[0].active, false, 'the drum and the note were one turn: one step');
  assert.equal(service.snapshot().drumState.kick.steps[0], false);
  assert.equal(service.undo(), false, 'nothing further back');
  assert.ok(events.includes('restored'));
  assert.equal(service.redo(), true);
  assert.equal(service.snapshot().drumState.kick.steps[0], true);
  assert.equal(service.redo(), true);
  assert.equal(service.getTempo().tempo, tempo + 20);
});

test('undo, undo, redo: the redo goes back to the scene of the edit it puts back', async () => {
  const service = setup();
  ok(service.setDrumStep('kick', 0, true));
  await turn();
  ok(service.createScene({ empty: true }));
  await turn();
  const second = service.snapshot().currentSceneId;
  ok(service.setDrumStep('snare', 4, true));
  await turn();
  const first = service.getScenes().scenes[0].id;
  ok(service.selectScene(first));
  ok(service.setDrumStep('kick', 8, true));
  await turn();
  ok(service.selectScene(second));
  assert.equal(service.undo(), true);
  assert.equal(service.snapshot().currentSceneId, first, 'the last edit was in the first scene');
  assert.equal(service.snapshot().drumState.kick.steps[8], false);
  assert.equal(service.undo(), true);
  assert.equal(service.snapshot().currentSceneId, second);
  assert.equal(service.snapshot().drumState.snare.steps[4], false);
  assert.equal(service.redo(), true);
  assert.equal(service.snapshot().currentSceneId, second, 'the snare was put in the second scene');
  assert.equal(service.snapshot().drumState.snare.steps[4], true);
  assert.equal(service.redo(), true);
  assert.equal(service.snapshot().currentSceneId, first);
  assert.equal(service.snapshot().drumState.kick.steps[8], true);
});

test('undo goes back to the scene the edit was made in, and takes back a scene that was made', async () => {
  const service = setup();
  const first = service.snapshot().currentSceneId;
  ok(service.setDrumStep('snare', 2, true));
  await turn();
  ok(service.createScene({ name: 'B' }));
  await turn();
  const second = service.snapshot().currentSceneId;
  assert.notEqual(second, first);
  ok(service.selectScene(second));
  assert.equal(service.undo(), true, 'the new scene is taken back');
  assert.equal(service.getScenes().scenes.length, 1);
  assert.equal(service.snapshot().currentSceneId, first);
  assert.equal(service.snapshot().drumState.snare.steps[2], true);
  assert.equal(service.undo(), true);
  assert.equal(service.snapshot().drumState.snare.steps[2], false);
});

test('undo leaves a lane\'s octave and keyboard as they are now', async () => {
  const service = setup();
  ok(service.setTempo(97));
  await turn();
  ok(service.apply({ type: 'synth.prefs', synthId: 1, octaveShift: 2, keyboardMode: 'piano-roll' }));
  assert.equal(service.undo(), true);
  const lane = service.snapshot().synths.find((entry: any) => entry.synthId === 1);
  assert.equal(lane.octaveShift, 2);
  assert.equal(lane.keyboardMode, 'piano-roll');
});

test('the turn is ended the way a browser allows: queueMicrotask is not called as a method', () => {
  const real = globalThis.queueMicrotask;
  // A browser throws "Illegal invocation" when it is called with anything but the window as `this`.
  globalThis.queueMicrotask = function (this: unknown, task: () => void) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    real(task);
  };
  try {
    const h = new UndoHistory();
    h.record(note, 0, 'p0');
    h.runAs('x');
    assert.equal(h.size.undo, 1);
  } finally { globalThis.queueMicrotask = real; }
});
