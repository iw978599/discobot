import Sequencer from './Sequencer';
import SynthControls from './SynthControls';
import KeyboardPanel from './KeyboardPanel';
import { Pattern, SynthParameters, SavedPatternFull, SynthModelId, SynthModelParams } from '../types';
import './SynthUnit.css';

interface SynthUnitProps {
  presets: Array<{ id: string; name: string; builtIn?: boolean }>;
  synthId: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  keyboardMode: 'keyboard' | 'piano-roll';
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  forceReleaseSignal: boolean;
  showRemoveButton: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onPatternChange: (pattern: Pattern) => void;
  onStepChange: (stepIndex: number) => void;
  onStepVelocityChange: (stepIndex: number, velocity: number) => void;
  onStepCountChange: (stepCount: 16 | 32) => void;
  onSavePattern: (name: string) => Promise<boolean>;
  onLoadSavedPattern: (data: SavedPatternFull, savedId?: string) => void;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  onSavePreset: (name: string) => void;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  onSynthModelChange: (modelId: SynthModelId) => void;
  onSynthModelParamsChange: (params: Partial<SynthModelParams>) => void;
  onKeyboardModeChange: (mode: 'keyboard' | 'piano-roll') => void;
  onOctaveShift: (direction: 'up' | 'down') => void;
  onPianoRollNoteAssign: (stepIndex: number, note?: string) => void;
  onClearPatternNotes: () => void;
  onRemove?: () => void;
  onPlayNote: (note: string) => void;
  onNoteRelease: (note: string) => void;
}

export default function SynthUnit({
  presets,
  synthId,
  pattern,
  patterns,
  synthParams,
  isPlaying,
  currentStep,
  selectedStep,
  keyboardMode,
  octaveShift,
  muted,
  solo,
  forceReleaseSignal,
  showRemoveButton,
  onToggleMute,
  onToggleSolo,
  onPatternChange,
  onStepChange,
  onStepVelocityChange,
  onStepCountChange,
  onSavePattern,
  onLoadSavedPattern,
  onParameterChange,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  synthModelId,
  synthModelParams,
  onSynthModelChange,
  onSynthModelParamsChange,
  onKeyboardModeChange,
  onOctaveShift,
  onPianoRollNoteAssign,
  onClearPatternNotes,
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
              presets={presets}
              onSavePreset={onSavePreset}
              onLoadPreset={onLoadPreset}
              onDeletePreset={onDeletePreset}
              synthModelId={synthModelId}
              synthModelParams={synthModelParams}
              onModelChange={onSynthModelChange}
              onModelParamsChange={onSynthModelParamsChange}
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
            onStepVelocityChange={onStepVelocityChange}
            onStepCountChange={onStepCountChange}
            onSavePattern={onSavePattern}
            onLoadSavedPattern={onLoadSavedPattern}
          />
        </div>

        <div className="synth-unit-keyboard-container">
          <KeyboardPanel
            mode={keyboardMode}
            onModeChange={onKeyboardModeChange}
            pattern={pattern}
            currentStep={currentStep}
            isPlaying={isPlaying}
            selectedStep={selectedStep}
            octaveShift={octaveShift}
            holdEnabled={Boolean(synthParams?.hold)}
            releaseSignal={forceReleaseSignal}
            onStepSelect={onStepChange}
            onNoteAssign={onPianoRollNoteAssign}
            onClearPattern={onClearPatternNotes}
            onNotePlay={onPlayNote}
            onNoteRelease={onNoteRelease}
          />
        </div>
      </div>
    </div>
  );
}
