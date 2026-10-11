import { useRef, useState } from 'react';
import { Pattern } from '../types';
import { stepNotes } from '../services/noteScheduling';
import { usePlayheadMark } from '../hooks/usePlayhead';
import { gridKeyTarget } from './gridKeys';

interface StepRowProps {
  pattern: Pattern;
  isPlaying: boolean;
  // Whose playhead lights the row: the synth lane's id.
  lane: number;
  selectedStep: number | null;
  onStepClick: (stepIndex: number) => void;
  // The bar on show: where it starts in the pattern and how many steps it has. Defaults to everything.
  firstStep?: number;
  visibleSteps?: number;
  // Left and right are already walking the selected step along this row (SynthModule), with
  // the keyboard following it, so the row leaves the arrow keys alone.
  arrowsWalk?: boolean;
}

// One synth lane's pattern as a row of lit cells, lined up with the drum grid below it.
export default function StepRow({ pattern, isPlaying, lane, selectedStep, onStepClick, firstStep = 0, visibleSteps, arrowsWalk = false }: StepRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The row is one stop for the Tab key: the selected step, or the step the keyboard was last on.
  const [focused, setFocused] = useState<number | null>(null);
  usePlayheadMark(rowRef, lane, isPlaying, '.step-light', 'on');
  const count = pattern.steps.length;
  const shown = visibleSteps ?? count;
  // Steps a longer note is still sounding through.
  const held = new Set<number>();
  pattern.steps.forEach((step, start) => {
    if (!step.active || !step.note) return;
    for (let offset = 1; offset < (step.length ?? 1) && start + offset < count; offset += 1) held.add(start + offset);
  });
  const onShow = (index: number | null): index is number => index !== null && index >= firstStep && index < Math.min(count, firstStep + shown);
  const stop = onShow(selectedStep) ? selectedStep : onShow(focused) ? focused : firstStep;
  return (
    <div
      ref={rowRef}
      className={`step-row steps-${shown}`}
      role="group"
      aria-label={`Synth ${lane} steps`}
      style={{ gridTemplateColumns: `repeat(${shown}, minmax(0, 1fr))` }}
      onKeyDown={(event) => {
        if (arrowsWalk || event.ctrlKey || event.metaKey || event.altKey) return;
        const cell = (event.target as HTMLElement).closest<HTMLElement>('.step-cell');
        const next = cell && gridKeyTarget(event.key, [[...event.currentTarget.querySelectorAll<HTMLElement>('.step-cell')]], cell);
        if (!next) return;
        event.preventDefault();
        next.focus();
      }}
    >
      {pattern.steps.slice(firstStep, firstStep + shown).map((step, column) => {
        const index = firstStep + column;
        const notes = stepNotes(step);
        const detail = [notes.join(' '), `velocity ${Math.round((step.velocity ?? 0.7) * 127)}`, (step.length ?? 1) > 1 ? `${step.length} steps long` : '', (step.offset ?? 0) > 0 ? 'starts late' : '', (step.probability ?? 1) < 1 ? `chance ${Math.round(step.probability! * 100)}%` : '', (step.ratchet ?? 1) > 1 ? `${step.ratchet} repeats` : '', step.slide ? 'slide' : ''].filter(Boolean).join(' · ');
        return (
          <button
            key={index}
            className={`step-cell ${step.note ? 'has-note' : ''} ${step.slide ? 'has-slide' : ''} ${step.note && (step.probability ?? 1) < 1 ? 'chance' : ''} ${!step.note && held.has(index) ? 'held' : ''} ${selectedStep === index ? 'selected' : ''} ${column % (shown / 4) === 0 ? 'beat' : ''}`}
            onClick={() => onStepClick(index)}
            aria-label={`Select step ${index + 1}${notes.length ? ` ${notes.join(' ')}` : ''}`}
            aria-pressed={selectedStep === index}
            tabIndex={index === stop ? 0 : -1}
            onFocus={() => setFocused(index)}
            title={step.note ? detail : `Step ${index + 1}`}
          >
            <span className="step-light" data-step={index} />
            <span className="step-note">{step.note || ''}{notes.length > 1 && <sup>+{notes.length - 1}</sup>}{step.note && (step.ratchet ?? 1) > 1 && <sup>×{step.ratchet}</sup>}</span>
            {step.note && <span className="step-velocity-bar" style={{ width: `${Math.max(8, (step.velocity ?? 0.7) * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}
