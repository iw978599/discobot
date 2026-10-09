import { Pattern } from '../types';
import { stepNotes } from '../services/noteScheduling';

interface StepRowProps {
  pattern: Pattern;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  onStepClick: (stepIndex: number) => void;
}

// One synth lane's pattern as a row of lit cells, lined up with the drum grid below it.
export default function StepRow({ pattern, isPlaying, currentStep, selectedStep, onStepClick }: StepRowProps) {
  const count = pattern.steps.length;
  // Steps a longer note is still sounding through.
  const held = new Set<number>();
  pattern.steps.forEach((step, start) => {
    if (!step.active || !step.note) return;
    for (let offset = 1; offset < (step.length ?? 1) && start + offset < count; offset += 1) held.add(start + offset);
  });
  return (
    <div className={`step-row steps-${count}`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {pattern.steps.map((step, index) => {
        const playing = isPlaying && currentStep === index;
        const notes = stepNotes(step);
        const detail = [notes.join(' '), `velocity ${Math.round((step.velocity ?? 0.7) * 127)}`, (step.length ?? 1) > 1 ? `${step.length} steps long` : '', (step.offset ?? 0) > 0 ? 'starts late' : '', (step.probability ?? 1) < 1 ? `chance ${Math.round(step.probability! * 100)}%` : '', (step.ratchet ?? 1) > 1 ? `${step.ratchet} repeats` : '', step.slide ? 'slide' : ''].filter(Boolean).join(' · ');
        return (
          <button
            key={index}
            className={`step-cell ${step.note ? 'has-note' : ''} ${step.slide ? 'has-slide' : ''} ${step.note && (step.probability ?? 1) < 1 ? 'chance' : ''} ${!step.note && held.has(index) ? 'held' : ''} ${selectedStep === index ? 'selected' : ''} ${index % (count / 4) === 0 ? 'beat' : ''}`}
            onClick={() => onStepClick(index)}
            aria-label={`Select step ${index + 1}${notes.length ? ` ${notes.join(' ')}` : ''}`}
            aria-pressed={selectedStep === index}
            title={step.note ? detail : `Step ${index + 1}`}
          >
            <span className={`step-light ${playing ? 'on' : ''}`} />
            <span className="step-note">{step.note || ''}{notes.length > 1 && <sup>+{notes.length - 1}</sup>}{step.note && (step.ratchet ?? 1) > 1 && <sup>×{step.ratchet}</sup>}</span>
            {step.note && <span className="step-velocity-bar" style={{ width: `${Math.max(8, (step.velocity ?? 0.7) * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}
