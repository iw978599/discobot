import Sequencer from './Sequencer';
import SynthControls from './SynthControls';
import Keyboard from './Keyboard';
import { Pattern, SynthParameters, SavedPatternFull } from '../types';
import './SynthUnit.css';

interface SynthUnitProps {
  synthId: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  octaveShift: number;
  showRemoveButton: boolean;
  onPlayStop: () => void;
  onPatternChange: (pattern: Pattern) => void;
  onStepChange: (stepIndex: number) => void;
  onTempoChange: (bpm: number) => void;
  onSavePattern: (name: string) => Promise<boolean>;
  onLoadSavedPattern: (data: SavedPatternFull) => void;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  onOctaveShift: (direction: 'up' | 'down') => void;
  onRemove?: () => void;
  onPlayNote: (note: string) => void;
  onNoteRelease: (note: string) => void;
}

export default function SynthUnit({
  synthId,
  pattern,
  patterns,
  synthParams,
  isPlaying,
  currentStep,
  selectedStep,
  octaveShift,
  showRemoveButton,
  onPlayStop,
  onPatternChange,
  onStepChange,
  onTempoChange,
  onSavePattern,
  onLoadSavedPattern,
  onParameterChange,
  onOctaveShift,
  onRemove,
  onPlayNote,
  onNoteRelease,
}: SynthUnitProps) {
  return (
    <div className="synth-unit">
      <div className="synth-unit-header">
        <h2>Synth {synthId}</h2>
        {showRemoveButton && onRemove && (
          <button className="remove-synth-btn" onClick={onRemove}>
            × Remove
          </button>
        )}
      </div>

      <div className="synth-unit-top">
        <div className="synth-unit-sequencer">
          <Sequencer
            pattern={pattern}
            patterns={patterns}
            isPlaying={isPlaying}
            currentStep={currentStep}
            selectedStep={selectedStep}
            onPlayStop={onPlayStop}
            onPatternChange={onPatternChange}
            onStepChange={onStepChange}
            onTempoChange={onTempoChange}
            onSavePattern={onSavePattern}
            onLoadSavedPattern={onLoadSavedPattern}
          />
        </div>

        <div className="synth-unit-controls">
          {synthParams && (
            <SynthControls
              parameters={synthParams}
              onParameterChange={onParameterChange}
            />
          )}
        </div>
      </div>

      <div className="synth-unit-keyboard-container">
        <button
          className="octave-shift-btn"
          onClick={() => onOctaveShift('down')}
          disabled={octaveShift <= -1}
          title="Shift octave down"
        >
          Oct -
        </button>

        <Keyboard
          onNotePlay={onPlayNote}
          onNoteRelease={onNoteRelease}
          octaveShift={octaveShift}
        />

        <button
          className="octave-shift-btn"
          onClick={() => onOctaveShift('up')}
          disabled={octaveShift >= 1}
          title="Shift octave up"
        >
          Oct +
        </button>
      </div>
    </div>
  );
}
