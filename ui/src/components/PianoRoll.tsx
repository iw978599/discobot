import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Fragment } from 'react';
import { Pattern } from '../types';
import { MAX_STEP_NOTES, stepNotes, stepOffset } from '../services/noteScheduling';
import { usePlayheadMark } from '../hooks/usePlayhead';
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
  onNoteAssign: (stepIndex: number, note: string, on: boolean, offset?: number) => void;
  // Sets how many steps the notes starting on a step last.
  onNoteLength: (stepIndex: number, length: number) => void;
  onClear: () => void;
  // The bar on show, for a pattern longer than one bar. Defaults to the whole pattern.
  firstStep?: number;
  visibleSteps?: number;
}

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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
}: PianoRollProps) {
  const [mouseDown, setMouseDown] = useState(false);
  const [paintMode, setPaintMode] = useState<'assign' | 'erase'>('assign');
  const lastPaintCell = useRef('');
  const pressedAt = useRef({ x: 0, y: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  usePlayheadMark(gridRef, lane, isPlaying, '.piano-roll-cell, .piano-roll-step-header', 'playing');

  useEffect(() => {
    const release = () => setMouseDown(false);
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
      for (let offset = 1; offset < (step.length ?? 1) && start + offset < pattern.steps.length; offset += 1) {
        for (const note of stepNotes(step)) cells.set(`${start + offset}:${note}`, start);
      }
    });
    return cells;
  }, [pattern]);
  // The note being stretched by its end: where it starts and how long it was last set to.
  const resizing = useRef<{ start: number; length: number } | null>(null);
  const onNoteLengthRef = useRef(onNoteLength);
  onNoteLengthRef.current = onNoteLength;

  // The handle moves to a new cell as the note grows, so the drag is followed on the window,
  // not on the handle that started it.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = resizing.current;
      if (!drag) return;
      const under = document.elementsFromPoint(event.clientX, event.clientY).find(element => element.classList.contains('piano-roll-cell')) as HTMLElement | undefined;
      if (!under?.dataset.step) return;
      const length = Math.max(1, Number(under.dataset.step) - drag.start + 1);
      if (length === drag.length) return;
      drag.length = length;
      onNoteLengthRef.current(drag.start, length);
    };
    const end = () => { resizing.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  if (!pattern) {
    return <div className="piano-roll">Loading...</div>;
  }

  const shown = visibleSteps ?? pattern.steps.length;
  const columns = Array.from({ length: shown }, (_, column) => firstStep + column).filter(index => index < pattern.steps.length);

  const has = (stepIndex: number, note: string) => stepNotes(pattern.steps[stepIndex]).includes(note);
  const full = (stepIndex: number) => stepNotes(pattern.steps[stepIndex]).length >= MAX_STEP_NOTES;

  const handleCellDown = (stepIndex: number, note: string, x: number, y: number, late = false) => {
    pressedAt.current = { x, y };
    lastPaintCell.current = `${stepIndex}:${note}`;
    const nextMode: 'assign' | 'erase' = has(stepIndex, note) ? 'erase' : 'assign';
    setPaintMode(nextMode);
    setMouseDown(true);
    onStepSelect(stepIndex);
    if (nextMode === 'erase' || !full(stepIndex)) onNoteAssign(stepIndex, note, nextMode === 'assign', late ? 0.5 : 0);
  };

  const handleCellEnter = (stepIndex: number, note: string, x: number, y: number) => {
    if (!mouseDown) return;
    // Selecting a step can move the grid under a pointer that is holding still. Only a pointer
    // that has itself moved is painting; otherwise one click would add a second note.
    if (Math.hypot(x - pressedAt.current.x, y - pressedAt.current.y) < 4) return;
    const cell = `${stepIndex}:${note}`;
    if (lastPaintCell.current === cell) return;
    lastPaintCell.current = cell;
    if (paintMode === 'assign' ? has(stepIndex, note) || full(stepIndex) : !has(stepIndex, note)) return;
    onStepSelect(stepIndex);
    onNoteAssign(stepIndex, note, paintMode === 'assign');
  };

  return (
    <div className="piano-roll">
      <div className="piano-roll-header">
        <h2>Piano Roll</h2>
        <span className="piano-roll-hint">Click notes in one column for a chord · drag a note's right edge to lengthen it · Alt+click starts a note halfway to the next step</span>
        <button className="piano-roll-action" onClick={onClear}>Clear</button>
      </div>

      <div
        ref={gridRef}
        className="piano-roll-grid"
        style={{ gridTemplateColumns: `minmax(58px, auto) repeat(${columns.length}, minmax(28px, 1fr))` }}
      >
        <div className="piano-roll-corner" />
        {columns.map((stepIndex) => (
          <div
            key={`step-header-${stepIndex}`}
            className={`piano-roll-step-header ${selectedStep === stepIndex ? 'selected' : ''}`}
            data-step={stepIndex}
          >
            {stepIndex + 1}
          </div>
        ))}

        {notes.map((note) => (
          <Fragment key={note}>
            <div key={`label-${note}`} className={`piano-roll-note-label ${note.includes('#') ? 'sharp' : ''}`}>
              {note}
            </div>
            {columns.map((stepIndex) => {
              const step = pattern.steps[stepIndex];
              const active = stepNotes(step).includes(note);
              const sustained = !active && held.has(`${stepIndex}:${note}`);
              const noteStart = active ? stepIndex : held.get(`${stepIndex}:${note}`);
              const noteLength = noteStart === undefined ? 1 : pattern.steps[noteStart].length ?? 1;
              // The handle sits on the last cell a note covers.
              const isEnd = noteStart !== undefined && stepIndex === Math.min(pattern.steps.length - 1, noteStart + noteLength - 1);
              const late = active ? stepOffset(step) : 0;
              return (
                <button
                  key={`${note}-${stepIndex}`}
                  className={`piano-roll-cell ${active ? 'active' : ''} ${late > 0 ? 'late' : ''} ${active && (step.length ?? 1) > 1 ? 'long' : ''} ${sustained ? 'held' : ''} ${selectedStep === stepIndex ? 'selected' : ''}`}
                  aria-label={`${note} step ${stepIndex + 1}`}
                  aria-pressed={active}
                  data-note={note}
                  data-step={stepIndex}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    handleCellDown(stepIndex, note, event.clientX, event.clientY, event.altKey);
                  }}
                  onPointerEnter={(event) => handleCellEnter(stepIndex, note, event.clientX, event.clientY)}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse' || !mouseDown) return;
                    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.piano-roll-cell');
                    if (cell?.dataset.note && cell.dataset.step) handleCellEnter(Number(cell.dataset.step), cell.dataset.note, event.clientX, event.clientY);
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    onStepSelect(stepIndex);
                    if (active || !full(stepIndex)) onNoteAssign(stepIndex, note, !active);
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
                    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-note="${nextNote}"][data-step="${nextStep}"]`)?.focus();
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
                        resizing.current = { start: noteStart!, length: noteLength };
                        onStepSelect(noteStart!);
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
