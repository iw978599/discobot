import { Pattern } from '../types';
import './Sequencer.css';

interface SequencerProps {
  pattern: Pattern | null;
  patterns: Pattern[];
  isPlaying: boolean;
  currentStep: number;
  onPlayStop: () => void;
  onPatternChange: (pattern: Pattern) => void;
  onStepChange: (stepIndex: number, active: boolean, note?: string) => void;
}

const NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

export default function Sequencer({
  pattern,
  patterns,
  isPlaying,
  currentStep,
  onPlayStop,
  onPatternChange,
  onStepChange,
}: SequencerProps) {
  if (!pattern) {
    return <div className="sequencer">Loading...</div>;
  }

  return (
    <div className="sequencer">
      <div className="sequencer-header">
        <h2>Sequencer</h2>
        <div className="sequencer-controls">
          <select
            value={pattern.id}
            onChange={(e) => {
              const selected = patterns.find((p) => p.id === e.target.value);
              if (selected) onPatternChange(selected);
            }}
          >
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={onPlayStop} className="play-button">
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
      </div>

      <div className="sequencer-grid">
        {pattern.steps.map((step, index) => (
          <div key={index} className="sequencer-column">
            <div className="step-indicator">
              <span className={currentStep === index && isPlaying ? 'active' : ''}>
                {index + 1}
              </span>
            </div>
            <button
              className={`step-button ${step.active ? 'active' : ''} ${
                currentStep === index && isPlaying ? 'playing' : ''
              }`}
              onClick={() => {
                if (step.active) {
                  onStepChange(index, false);
                } else {
                  onStepChange(index, true, NOTES[index % NOTES.length]);
                }
              }}
            >
              {step.note || ''}
            </button>
          </div>
        ))}
      </div>

      <div className="sequencer-info">
        <span>Tempo: {pattern.tempo} BPM</span>
      </div>
    </div>
  );
}
