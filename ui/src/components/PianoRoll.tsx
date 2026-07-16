import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    const release = () => setMouseDown(false);
    window.addEventListener('mouseup', release);
    return () => window.removeEventListener('mouseup', release);
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
    const active = pattern.steps[stepIndex]?.note === note;
    const nextMode: 'assign' | 'erase' = active ? 'erase' : 'assign';
    setPaintMode(nextMode);
    setMouseDown(true);
    onStepSelect(stepIndex);
    onNoteAssign(stepIndex, nextMode === 'assign' ? note : undefined);
  };

  const handleCellEnter = (stepIndex: number, note: string) => {
    if (!mouseDown) return;
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
        style={{ gridTemplateColumns: `minmax(58px, auto) repeat(${pattern.steps.length}, minmax(0, 1fr))` }}
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
                  onMouseDown={() => handleCellDown(stepIndex, note)}
                  onMouseEnter={() => handleCellEnter(stepIndex, note)}
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
