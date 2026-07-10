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

      <div className="synth-unit-layout">
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
            onSavePattern={onSavePattern}
            onLoadSavedPattern={onLoadSavedPattern}
          />
        </div>

        <div className="synth-unit-keyboard-container">
          <Keyboard
            onNotePlay={onPlayNote}
            onNoteRelease={onNoteRelease}
            octaveShift={octaveShift}
          />
        </div>

        <div className="synth-unit-controls">
          {synthParams && (
            <SynthControls
              parameters={synthParams}
              onParameterChange={onParameterChange}
              octaveShift={octaveShift}
              onOctaveShift={onOctaveShift}
            />
          )}
        </div>
      </div>
    </div>
  );
}
