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
  muted: boolean;
  solo: boolean;
  showRemoveButton: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
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
  muted,
  solo,
  showRemoveButton,
  onToggleMute,
  onToggleSolo,
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
        <div className="synth-unit-header-actions">
          <button className={`synth-mix-btn ${muted ? 'active' : ''}`} onClick={onToggleMute}>
            Mute
          </button>
          <button className={`synth-mix-btn ${solo ? 'active' : ''}`} onClick={onToggleSolo}>
            Solo
          </button>
          {showRemoveButton && onRemove && (
            <button className="remove-synth-btn" onClick={onRemove}>
              × Remove
            </button>
          )}
        </div>
      </div>

      <div className="synth-unit-layout">
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

        <div className="synth-unit-sequencer">
          <Sequencer
            pattern={pattern}
            patterns={patterns}
            isPlaying={isPlaying}
            currentStep={currentStep}
            selectedStep={selectedStep}
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
      </div>
    </div>
  );
}
