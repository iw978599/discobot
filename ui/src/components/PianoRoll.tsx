import { useEffect, useMemo, useRef, useState } from 'react';
import { Fragment } from 'react';
import { Pattern } from '../types';
import './PianoRoll.css';

interface PianoRollProps {
  pattern: Pattern | null;
  currentStep: number;
  isPlaying: boolean;
  selectedStep: number | null;
  octaveShift: number;
  onStepSelect: (stepIndex: number) => void;
  onNoteAssign: (stepIndex: number, note?: string) => void;
  onClear: () => void;
}

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export default function PianoRoll({
  pattern,
  currentStep,
  isPlaying,
  selectedStep,
  octaveShift,
  onStepSelect,
  onNoteAssign,
  onClear,
}: PianoRollProps) {
  const [mouseDown, setMouseDown] = useState(false);
  const [paintMode, setPaintMode] = useState<'assign' | 'erase'>('assign');
  const lastPaintCell = useRef('');

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

  if (!pattern) {
    return <div className="piano-roll">Loading...</div>;
  }

  const handleCellDown = (stepIndex: number, note: string) => {
    lastPaintCell.current = `${stepIndex}:${note}`;
    const active = pattern.steps[stepIndex]?.note === note;
    const nextMode: 'assign' | 'erase' = active ? 'erase' : 'assign';
    setPaintMode(nextMode);
    setMouseDown(true);
    onStepSelect(stepIndex);
    onNoteAssign(stepIndex, nextMode === 'assign' ? note : undefined);
  };

  const handleCellEnter = (stepIndex: number, note: string) => {
    if (!mouseDown) return;
    const cell = `${stepIndex}:${note}`;
    if (lastPaintCell.current === cell) return;
    lastPaintCell.current = cell;
    const existing = pattern.steps[stepIndex]?.note;
    if (paintMode === 'assign' ? existing === note : existing !== note) return;
    onStepSelect(stepIndex);
    onNoteAssign(stepIndex, paintMode === 'assign' ? note : undefined);
  };

  return (
    <div className="piano-roll">
      <div className="piano-roll-header">
        <h2>Piano Roll</h2>
        <button className="piano-roll-action" onClick={onClear}>Clear</button>
      </div>

      <div
        className="piano-roll-grid"
        style={{ gridTemplateColumns: `minmax(58px, auto) repeat(${pattern.steps.length}, minmax(28px, 1fr))` }}
      >
        <div className="piano-roll-corner" />
        {pattern.steps.map((_, stepIndex) => (
          <div
            key={`step-header-${stepIndex}`}
            className={`piano-roll-step-header ${isPlaying && currentStep === stepIndex ? 'playing' : ''} ${selectedStep === stepIndex ? 'selected' : ''}`}
          >
            {stepIndex + 1}
          </div>
        ))}

        {notes.map((note) => (
          <Fragment key={note}>
            <div key={`label-${note}`} className={`piano-roll-note-label ${note.includes('#') ? 'sharp' : ''}`}>
              {note}
            </div>
            {pattern.steps.map((step, stepIndex) => {
              const active = step.note === note;
              return (
                <button
                  key={`${note}-${stepIndex}`}
                  className={`piano-roll-cell ${active ? 'active' : ''} ${isPlaying && currentStep === stepIndex ? 'playing' : ''} ${selectedStep === stepIndex ? 'selected' : ''}`}
                  aria-label={`${note} step ${stepIndex + 1}`}
                  aria-pressed={active}
                  data-note={note}
                  data-step={stepIndex}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    handleCellDown(stepIndex, note);
                  }}
                  onPointerEnter={() => handleCellEnter(stepIndex, note)}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse' || !mouseDown) return;
                    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.piano-roll-cell');
                    if (cell?.dataset.note && cell.dataset.step) handleCellEnter(Number(cell.dataset.step), cell.dataset.note);
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    onStepSelect(stepIndex);
                    onNoteAssign(stepIndex, active ? undefined : note);
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
                  style={{ touchAction: 'none' }}
                  type="button"
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
