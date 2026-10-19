import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pattern } from '../types';
import { MAX_STEP_NOTES, noteLengths, stepNotes, stepOffset } from '../services/noteScheduling';
import { CHORD_SHAPES, INVERSIONS, chordNotes, type ChordShapeId } from '../services/chords';
import { usePlayheadMark } from '../hooks/usePlayhead';
import { useNarrow } from '../hooks/useNarrow';
import { beatLength, onBeat } from '../services/patternLength';
import { TAP_HOLD_MS, TAP_SLOP } from './useKnobInteraction';
import './PianoRoll.css';

interface PianoRollProps {
  pattern: Pattern | null;
  // Whose playhead lights the playing column: the synth lane's id.
  lane: number;
  isPlaying: boolean;
  selectedStep: number | null;
  octaveShift: number;
  onStepSelect: (stepIndex: number) => void;
  // Adds the note to the step's chord, or takes it out.
  // `offset` starts a new step's note that far into the step.
  onNoteAssign: (stepIndex: number, note: string | string[], on: boolean, offset?: number) => void;
  // Sets how many steps the notes starting on a step last.
  // With a note, that note of the step's chord alone; without, every note of the step.
  onNoteLength: (stepIndex: number, length: number, note?: string) => void;
  onClear: () => void;
  // The bar on show, for a pattern longer than one bar. Defaults to the whole pattern.
  firstStep?: number;
  visibleSteps?: number;
  // The scene's time signature: which steps start a beat, and how far the phone's buttons move.
  signature?: unknown;
}

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// On a phone: the narrowest a cell may be and how many steps may be across at once. The two
// buttons move along the bar a beat at a time: four steps, or six where the beat is six (6/8, 12/8).
const MIN_CELL = 44;
const ACROSS = [32, 16, 12, 8, 6, 4];

export default function PianoRoll({
  pattern,
  lane,
  isPlaying,
  selectedStep,
  octaveShift,
  onStepSelect,
  onNoteAssign,
  onNoteLength,
  onClear,
  firstStep = 0,
  visibleSteps,
  signature,
}: PianoRollProps) {
  const TURN = beatLength(signature);
  // What a pressed pointer is doing as it moves over cells, if anything.
  const painting = useRef<'assign' | 'erase' | null>(null);
  // Whether a pointer is down on the grid. Nothing may move the grid while one is.
  const pressing = useRef(false);
  // A finger on a note that is already there. Lifted soon, it takes the note out; moved, it
  // rubs out as it goes; held still, it leaves the note alone, with its step selected.
  const waiting = useRef<{ id: number; step: number; note: string; x: number; y: number; at: number } | null>(null);
  const lastPaintCell = useRef('');
  const pressedAt = useRef({ x: 0, y: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  usePlayheadMark(gridRef, lane, isPlaying, '.piano-roll-cell, .piano-roll-step-header', 'playing');
  // Whether stretching a note by its end stretches every note of its step with it. Off, each note
  // of a chord has a length of its own. The window's listeners read the ref.
  const [wholeStep, setWholeStep] = useState(false);
  const wholeStepRef = useRef(wholeStep);
  wholeStepRef.current = wholeStep;
  // Which chord a note put in brings with it. It is how the roll is being used, not part of the song.
  const [chord, setChord] = useState<ChordShapeId | 'off'>('off');
  const [inversion, setInversion] = useState(0);
  const onNoteAssignRef = useRef(onNoteAssign);
  onNoteAssignRef.current = onNoteAssign;

  const narrow = useNarrow();
  const total = pattern?.steps.length ?? 0;
  const count = Math.max(0, Math.min(visibleSteps ?? total, total - firstStep));
  // A narrow screen shows as many steps of the bar as fit at a finger's width, and the grid is
  // moved along under them. `first` is the column at its left edge, read back from the grid.
  const [across, setAcross] = useState(0);
  const [first, setFirst] = useState(0);
  const fit = narrow && across > 0 ? Math.min(across, count) : count;
  const paged = fit < count;
  // The one cell of the grid the Tab key stops on: the last one that had the keyboard.
  const [cursor, setCursor] = useState<{ note: string; step: number } | null>(null);

  // The finger that was waiting on a note has lifted. Soon enough, that was a tap.
  const settleTap = (pointerId: number, timeStamp: number) => {
    const tap = waiting.current;
    if (!tap || tap.id !== pointerId) return;
    waiting.current = null;
    if (timeStamp - tap.at < TAP_HOLD_MS) onNoteAssignRef.current(tap.step, tap.note, false);
  };
  useEffect(() => {
    const release = (event: Event) => {
      if (event.type === 'pointerup') settleTap((event as PointerEvent).pointerId, event.timeStamp);
      waiting.current = null;
      painting.current = null;
      pressing.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  const notes = useMemo(() => {
    const baseOctave = 3 + octaveShift;
    const all: string[] = [];
    for (let octave = baseOctave + 2; octave >= baseOctave; octave -= 1) {
      for (let idx = NOTE_ORDER.length - 1; idx >= 0; idx -= 1) {
        all.push(`${NOTE_ORDER[idx]}${octave}`);
      }
    }
    return all;
  }, [octaveShift]);

  // Cells a longer note sounds through after the step it starts on, and the step each began on.
  const held = useMemo(() => {
    const cells = new Map<string, number>();
    pattern?.steps.forEach((step, start) => {
      const lengths = noteLengths(step);
      stepNotes(step).forEach((note, index) => {
        for (let offset = 1; offset < lengths[index] && start + offset < pattern.steps.length; offset += 1) cells.set(`${start + offset}:${note}`, start);
      });
    });
    return cells;
  }, [pattern]);
  // The note being stretched by its end: where it starts and how long it was last set to. A
  // finger that lands on the end of a one-step note may only be tapping the note: `tap` is
  // that touch, until it moves.
  const resizing = useRef<{ start: number; length: number; note: string; tap?: { id: number; note: string; x: number; y: number; at: number } } | null>(null);
  const onNoteLengthRef = useRef(onNoteLength);
  onNoteLengthRef.current = onNoteLength;

  // The handle moves to a new cell as the note grows, so the drag is followed on the window,
  // not on the handle that started it.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = resizing.current;
      if (!drag) return;
      if (drag.tap && drag.tap.id === event.pointerId) {
        if (Math.hypot(event.clientX - drag.tap.x, event.clientY - drag.tap.y) < TAP_SLOP) return;
        drag.tap = undefined;
      }
      const under = document.elementsFromPoint(event.clientX, event.clientY).find(element => element.classList.contains('piano-roll-cell')) as HTMLElement | undefined;
      if (!under?.dataset.step) return;
      const length = Math.max(1, Number(under.dataset.step) - drag.start + 1);
      if (length === drag.length) return;
      drag.length = length;
      onNoteLengthRef.current(drag.start, length, wholeStepRef.current ? undefined : drag.note);
    };
    const end = (event: PointerEvent) => {
      const drag = resizing.current;
      resizing.current = null;
      // Lifted soon without having moved, the finger was not stretching the note. That was a
      // tap, and a tap on a note takes it out.
      const tap = drag?.tap;
      if (tap && event.type === 'pointerup' && tap.id === event.pointerId && event.timeStamp - tap.at < TAP_HOLD_MS) onNoteAssignRef.current(drag.start, tap.note, false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  // Puts a column of the bar at the left edge of the grid, beside the note names.
  const firstStepRef = useRef(firstStep);
  firstStepRef.current = firstStep;
  const place = (column: number) => {
    const grid = gridRef.current;
    const head = grid?.querySelector<HTMLElement>(`.piano-roll-step-header[data-step="${firstStepRef.current + column}"]`);
    const corner = grid?.querySelector('.piano-roll-corner');
    if (!grid || !head || !corner) return;
    grid.scrollLeft += head.getBoundingClientRect().left - corner.getBoundingClientRect().right - 1;
  };
  const firstRef = useRef(first);
  firstRef.current = first;
  const countRef = useRef(count);
  countRef.current = count;

  // How many steps fit across, measured whenever the grid changes size: first shown, the phone
  // turned, its unit brought back by the bar. The grid also starts at its lowest notes, the
  // octave the octave setting names, with the higher ones above to be scrolled to.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!narrow || !grid || typeof ResizeObserver === 'undefined') {
      setAcross(0);
      return;
    }
    let width = 0;
    const settle = () => {
      const now = grid.clientWidth;
      if (now === width) return;
      const shown = width === 0;
      width = now;
      if (now === 0) return;
      const label = grid.querySelector('.piano-roll-corner')?.getBoundingClientRect().width ?? 0;
      const room = Math.floor((now - label) / (MIN_CELL + 1));
      // A whole bar when it fits (a bar can be 12, 14, 20 or 24 steps), else the most that do.
      setAcross(countRef.current > 0 && countRef.current <= room ? countRef.current : ACROSS.find(steps => steps <= room) ?? ACROSS[ACROSS.length - 1]);
      if (shown) grid.scrollTop = grid.scrollHeight;
      place(firstRef.current);
    };
    const read = () => {
      const heads = grid.querySelectorAll<HTMLElement>('.piano-roll-step-header');
      if (heads.length < 2 || grid.clientWidth === 0) return;
      const stride = heads[1].getBoundingClientRect().left - heads[0].getBoundingClientRect().left;
      if (stride > 0) setFirst(Math.max(0, Math.round(grid.scrollLeft / stride)));
    };
    const observer = new ResizeObserver(settle);
    observer.observe(grid);
    // Counted here as well, before the first paint, or the bar would show squeezed for a moment.
    settle();
    grid.addEventListener('scroll', read);
    return () => {
      observer.disconnect();
      grid.removeEventListener('scroll', read);
    };
  }, [narrow, Boolean(pattern), count]);
  // Once the number across is known the columns have their width, and the grid can be lined up.
  useLayoutEffect(() => {
    if (narrow) place(Math.min(firstRef.current, Math.max(0, count - fit)));
  }, [narrow, fit, count]);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (narrow && grid) grid.scrollTop = grid.scrollHeight;
  }, [narrow, octaveShift]);
  // A step selected somewhere else (the row of steps, the arrow keys) is brought on show. Not
  // one selected by pressing the grid itself: that would move the grid under the finger.
  useLayoutEffect(() => {
    if (!paged || pressing.current || selectedStep === null) return;
    const column = selectedStep - firstStep;
    if (column < 0 || column >= count || (column >= first && column < first + fit)) return;
    place(Math.max(0, Math.min(count - fit, Math.floor(column / TURN) * TURN)));
  }, [selectedStep]);

  if (!pattern) {
    return <div className="piano-roll">Loading...</div>;
  }

  const shown = visibleSteps ?? pattern.steps.length;
  const columns = Array.from({ length: shown }, (_, column) => firstStep + column).filter(index => index < pattern.steps.length);

  const has = (stepIndex: number, note: string) => stepNotes(pattern.steps[stepIndex]).includes(note);
  const full = (stepIndex: number) => stepNotes(pattern.steps[stepIndex]).length >= MAX_STEP_NOTES;
  // With a chord shape chosen, a note put in is the root and brings the rest of the chord with it,
  // as far as the roll has rows for them. Taking a note out is always that note alone.
  const adding = (note: string) => (chord === 'off' ? note : chordNotes(note, chord, inversion).filter(entry => notes.includes(entry)));

  const handleCellDown = (stepIndex: number, note: string, x: number, y: number, late = false) => {
    pressedAt.current = { x, y };
    lastPaintCell.current = `${stepIndex}:${note}`;
    const nextMode: 'assign' | 'erase' = has(stepIndex, note) ? 'erase' : 'assign';
    painting.current = nextMode;
    pressing.current = true;
    onStepSelect(stepIndex);
    if (nextMode === 'erase') onNoteAssign(stepIndex, note, false);
    else if (!full(stepIndex)) onNoteAssign(stepIndex, adding(note), true, late ? 0.5 : 0);
  };

  const handleCellEnter = (stepIndex: number, note: string, x: number, y: number) => {
    const mode = painting.current;
    if (!mode) return;
    // Selecting a step can move the grid under a pointer that is holding still. Only a pointer
    // that has itself moved is painting; otherwise one click would add a second note.
    if (Math.hypot(x - pressedAt.current.x, y - pressedAt.current.y) < 4) return;
    const cell = `${stepIndex}:${note}`;
    if (lastPaintCell.current === cell) return;
    lastPaintCell.current = cell;
    if (mode === 'assign' ? has(stepIndex, note) || full(stepIndex) : !has(stepIndex, note)) return;
    onStepSelect(stepIndex);
    onNoteAssign(stepIndex, mode === 'assign' ? adding(note) : note, mode === 'assign');
  };

  const lastFirst = Math.max(0, count - fit);
  const turn = (direction: 1 | -1) => {
    const next = direction > 0 ? Math.floor(first / TURN) * TURN + TURN : Math.ceil(first / TURN) * TURN - TURN;
    place(Math.max(0, Math.min(lastFirst, next)));
  };
  const from = Math.min(first, lastFirst);

  const stopStep = cursor && columns.includes(cursor.step) ? cursor.step : selectedStep !== null && columns.includes(selectedStep) ? selectedStep : columns[0];
  const stopNote = cursor && columns.includes(cursor.step) && notes.includes(cursor.note) ? cursor.note
    : (stopStep === undefined ? [] : stepNotes(pattern.steps[stopStep])).find(note => notes.includes(note)) ?? notes[notes.length - 1];

  return (
    <div className="piano-roll">
      <div className="piano-roll-header">
        <h2>Piano Roll</h2>
        {narrow
          ? <span className="piano-roll-hint">Tap a square to add a note or take it out, or drag to paint. Hold a note to select its step and keep it. Drag a note's bright end to make it longer, and the note names to reach higher notes.</span>
          : <span className="piano-roll-hint">Click notes in one column for a chord · drag a note's right edge to lengthen it · Alt+click starts a note halfway to the next step</span>}
        {paged && (
          <div className="piano-roll-pager" role="group" aria-label="Steps on show">
            <button className="rack-btn" type="button" aria-label="Earlier steps" disabled={from <= 0} onClick={() => turn(-1)}>◀</button>
            <output className="piano-roll-window">{firstStep + from + 1}–{firstStep + from + fit}</output>
            <button className="rack-btn" type="button" aria-label="Later steps" disabled={from >= lastFirst} onClick={() => turn(1)}>▶</button>
          </div>
        )}
        <button
          className={`rack-btn piano-roll-whole ${wholeStep ? 'on' : ''}`}
          type="button"
          aria-pressed={wholeStep}
          title="Off: dragging a note's end makes that one note longer. On: every note in its step goes with it"
          onClick={() => setWholeStep(value => !value)}
        >
          Whole step
        </button>
        <label className="piano-roll-chord" title="Choose a chord shape, then put a note in: it is the root, and the rest of the chord comes with it. Each note can still be taken out by itself">
          Chord
          <select aria-label="Chord shape" value={chord} onChange={(event) => setChord(event.target.value as ChordShapeId | 'off')}>
            <option value="off">Off</option>
            {CHORD_SHAPES.map(shape => <option key={shape.id} value={shape.id}>{shape.name}</option>)}
          </select>
        </label>
        <label className="piano-roll-chord" title="Which note of the chord is lowest. The note you put in stays where it is, and the notes above it go down an octave">
          Inversion
          <select aria-label="Chord inversion" value={inversion} disabled={chord === 'off'} onChange={(event) => setInversion(Number(event.target.value))}>
            {INVERSIONS.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </label>
        <button className="rack-btn danger piano-roll-action" onClick={onClear}>Clear</button>
      </div>

      {/* A grid to a screen reader: each row and each cell's wrapper has no box of its own
          (display: contents), so the layout is still one grid of headers and buttons. */}
      <div
        ref={gridRef}
        className="piano-roll-grid"
        role="grid"
        aria-label="Piano roll notes"
        style={{ gridTemplateColumns: `minmax(58px, auto) repeat(${columns.length}, minmax(28px, 1fr))`, '--roll-columns': columns.length, '--roll-fit': Math.max(1, fit) } as CSSProperties}
        onFocus={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>('.piano-roll-cell');
          if (!cell?.dataset.note || !cell.dataset.step) return;
          const next = { note: cell.dataset.note, step: Number(cell.dataset.step) };
          setCursor(now => (now && now.note === next.note && now.step === next.step ? now : next));
        }}
        // A finger held on the grid is editing, not asking for the browser's menu, which would
        // also take the touch that follows it.
        onContextMenu={(event) => { if (pressing.current || ['touch', 'pen'].includes((event.nativeEvent as PointerEvent).pointerType)) event.preventDefault(); }}
      >
        <div className="piano-roll-row" role="row">
          <div className="piano-roll-corner" role="columnheader" aria-label="Note" />
          {columns.map((stepIndex) => (
            <div
              key={`step-header-${stepIndex}`}
              className={`piano-roll-step-header ${selectedStep === stepIndex ? 'selected' : ''} ${onBeat(signature, stepIndex - firstStep, shown) ? 'beat' : ''}`}
              role="columnheader"
              aria-label={`Step ${stepIndex + 1}`}
              data-step={stepIndex}
            >
              {stepIndex + 1}
            </div>
          ))}
        </div>

        {notes.map((note) => (
          <div key={note} className="piano-roll-row" role="row">
            <div className={`piano-roll-note-label ${note.includes('#') ? 'sharp' : ''}`} role="rowheader">
              {note}
            </div>
            {columns.map((stepIndex) => {
              const step = pattern.steps[stepIndex];
              const active = stepNotes(step).includes(note);
              const sustained = !active && held.has(`${stepIndex}:${note}`);
              const noteStart = active ? stepIndex : held.get(`${stepIndex}:${note}`);
              const noteLength = noteStart === undefined ? 1 : noteLengths(pattern.steps[noteStart])[stepNotes(pattern.steps[noteStart]).indexOf(note)] ?? 1;
              // The handle sits on the last cell a note covers.
              const isEnd = noteStart !== undefined && stepIndex === Math.min(pattern.steps.length - 1, noteStart + noteLength - 1);
              const late = active ? stepOffset(step) : 0;
              return (
                <div key={`${note}-${stepIndex}`} className="piano-roll-slot" role="gridcell">
                <button
                  className={`piano-roll-cell ${active ? 'active' : ''} ${late > 0 ? 'late' : ''} ${active && noteLength > 1 ? 'long' : ''} ${sustained ? 'held' : ''} ${selectedStep === stepIndex ? 'selected' : ''}`}
                  aria-label={`${note} step ${stepIndex + 1}`}
                  aria-pressed={active}
                  tabIndex={stopStep === stepIndex && stopNote === note ? 0 : -1}
                  data-note={note}
                  data-step={stepIndex}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    if (event.pointerType !== 'mouse' && active) {
                      pressing.current = true;
                      waiting.current = { id: event.pointerId, step: stepIndex, note, x: event.clientX, y: event.clientY, at: event.timeStamp };
                      onStepSelect(stepIndex);
                      return;
                    }
                    handleCellDown(stepIndex, note, event.clientX, event.clientY, event.altKey);
                  }}
                  onPointerUp={(event) => settleTap(event.pointerId, event.timeStamp)}
                  onPointerEnter={(event) => handleCellEnter(stepIndex, note, event.clientX, event.clientY)}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse') return;
                    const tap = waiting.current;
                    if (tap && tap.id === event.pointerId) {
                      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < TAP_SLOP) return;
                      waiting.current = null;
                      // Moved after being held still, the finger is only leaving. Moved straight
                      // away, it rubs out the note it began on and whatever it crosses.
                      if (event.timeStamp - tap.at < TAP_HOLD_MS && has(tap.step, tap.note)) handleCellDown(tap.step, tap.note, tap.x, tap.y);
                      return;
                    }
                    if (!painting.current) return;
                    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.piano-roll-cell');
                    if (cell?.dataset.note && cell.dataset.step) handleCellEnter(Number(cell.dataset.step), cell.dataset.note, event.clientX, event.clientY);
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    onStepSelect(stepIndex);
                    if (active) onNoteAssign(stepIndex, note, false);
                    else if (!full(stepIndex)) onNoteAssign(stepIndex, adding(note), true);
                  }}
                  onKeyDown={(event) => {
                    const row = notes.indexOf(note);
                    let nextRow = row;
                    let nextStep = stepIndex;
                    if (event.key === 'ArrowUp') nextRow -= 1;
                    else if (event.key === 'ArrowDown') nextRow += 1;
                    else if (event.key === 'ArrowLeft') nextStep -= 1;
                    else if (event.key === 'ArrowRight') nextStep += 1;
                    else if (event.key === 'Home') nextStep = 0;
                    else if (event.key === 'End') nextStep = pattern.steps.length - 1;
                    else return;
                    event.preventDefault();
                    const nextNote = notes[Math.max(0, Math.min(notes.length - 1, nextRow))];
                    nextStep = Math.max(0, Math.min(pattern.steps.length - 1, nextStep));
                    gridRef.current?.querySelector<HTMLButtonElement>(`[data-note="${nextNote}"][data-step="${nextStep}"]`)?.focus();
                  }}
                  style={{ touchAction: 'none', ...(late > 0 ? { '--late': `${Math.round(late * 100)}%` } as CSSProperties : {}) }}
                  type="button"
                >
                  {isEnd && (
                    <span
                      className="piano-roll-resize"
                      title="Drag to change how long this note lasts"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        // A finger's events would go on arriving at this handle, which is taken
                        // away as the note grows. They are sent to the grid, which stays.
                        if (event.pointerType !== 'mouse') {
                          try { gridRef.current?.setPointerCapture(event.pointerId); } catch { /* the drag is still followed on the window */ }
                        }
                        pressing.current = true;
                        resizing.current = {
                          start: noteStart!,
                          length: noteLength,
                          note,
                          tap: event.pointerType !== 'mouse' && active ? { id: event.pointerId, note, x: event.clientX, y: event.clientY, at: event.timeStamp } : undefined,
                        };
                        onStepSelect(noteStart!);
                      }}
                      // No click handler here. One would make the handle something to click, and a
                      // browser steers a finger that lands near such a thing onto it, off the note.
                      // The cell acts on a click only when it comes from the keyboard.
                    />
                  )}
                </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
