import Keyboard from './Keyboard';
import PianoRoll from './PianoRoll';
import { Pattern } from '../types';
import './KeyboardPanel.css';

interface KeyboardPanelProps {
  mode: 'keyboard' | 'piano-roll';
  onModeChange: (mode: 'keyboard' | 'piano-roll') => void;
  pattern: Pattern | null;
  currentStep: number;
  isPlaying: boolean;
  selectedStep: number | null;
  octaveShift: number;
  holdEnabled: boolean;
  releaseSignal: boolean;
  onStepSelect: (stepIndex: number) => void;
  onNoteAssign: (stepIndex: number, note?: string) => void;
  onClearPattern: () => void;
  onNotePlay: (note: string) => void;
  onNoteRelease: (note: string) => void;
}

export default function KeyboardPanel({
  mode,
  onModeChange,
  pattern,
  currentStep,
  isPlaying,
  selectedStep,
  octaveShift,
  holdEnabled,
  releaseSignal,
  onStepSelect,
  onNoteAssign,
  onClearPattern,
  onNotePlay,
  onNoteRelease,
}: KeyboardPanelProps) {
  return (
    <div className="keyboard-panel">
      <div className="keyboard-panel-toggle">
        <button
          className={mode === 'keyboard' ? 'active' : ''}
          onClick={() => onModeChange('keyboard')}
          title="Keyboard"
        >
          🎹
        </button>
        <button
          className={mode === 'piano-roll' ? 'active' : ''}
          onClick={() => onModeChange('piano-roll')}
          title="Piano Roll"
        >
          📊
        </button>
      </div>

      {mode === 'keyboard' ? (
        <Keyboard
          onNotePlay={onNotePlay}
          onNoteRelease={onNoteRelease}
          holdEnabled={holdEnabled}
          octaveShift={octaveShift}
          releaseSignal={releaseSignal}
        />
      ) : (
        <PianoRoll
          pattern={pattern}
          currentStep={currentStep}
          isPlaying={isPlaying}
          selectedStep={selectedStep}
          octaveShift={octaveShift}
          onStepSelect={onStepSelect}
          onNoteAssign={onNoteAssign}
          onClear={onClearPattern}
        />
      )}
    </div>
  );
}
