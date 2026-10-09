import { Pattern } from '../types';

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
  return (
    <div className={`step-row steps-${count}`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {pattern.steps.map((step, index) => {
        const playing = isPlaying && currentStep === index;
        return (
          <button
            key={index}
            className={`step-cell ${step.note ? 'has-note' : ''} ${step.slide ? 'has-slide' : ''} ${selectedStep === index ? 'selected' : ''} ${index % (count / 4) === 0 ? 'beat' : ''}`}
            onClick={() => onStepClick(index)}
            aria-label={`Select step ${index + 1}${step.note ? ` ${step.note}` : ''}`}
            aria-pressed={selectedStep === index}
            title={step.note ? `${step.note} · velocity ${Math.round((step.velocity ?? 0.7) * 127)}${step.slide ? ' · slide' : ''}` : `Step ${index + 1}`}
          >
            <span className={`step-light ${playing ? 'on' : ''}`} />
            <span className="step-note">{step.note || ''}</span>
            {step.note && <span className="step-velocity-bar" style={{ width: `${Math.max(8, (step.velocity ?? 0.7) * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}
