import Keyboard from './Keyboard';
import PianoRoll from './PianoRoll';
import { Pattern } from '../types';
import { QUANTIZE_CHOICES } from '../services/recordTiming';
import './KeyboardPanel.css';

interface KeyboardPanelProps {
  mode: 'keyboard' | 'piano-roll';
  onModeChange: (mode: 'keyboard' | 'piano-roll') => void;
  pattern: Pattern | null;
  // Whose playhead the piano roll shows: the synth lane's id.
  lane: number;
  isPlaying: boolean;
  selectedStep: number | null;
  octaveShift: number;
  onOctaveShift: (direction: 'up' | 'down') => void;
  holdEnabled: boolean;
  releaseSignal: boolean;
  computerKeyNotes?: ReadonlySet<string>;
  onStepSelect: (stepIndex: number) => void;
  onNoteAssign: (stepIndex: number, note: string | string[], on: boolean, offset?: number) => void;
  onNoteLength: (stepIndex: number, length: number, note?: string) => void;
  firstStep?: number;
  visibleSteps?: number;
  onClearPattern: () => void;
  onNotePlay: (note: string) => void;
  onNoteRelease: (note: string) => void;
  // Recording what is played while the song runs, and how firmly it is moved onto the nearest step.
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  quantize: number;
  onQuantizeChange: (strength: number) => void;
}

export default function KeyboardPanel({
  mode,
  onModeChange,
  pattern,
  lane,
  isPlaying,
  selectedStep,
  octaveShift,
  onOctaveShift,
  holdEnabled,
  releaseSignal,
  computerKeyNotes,
  onStepSelect,
  onNoteAssign,
  onNoteLength,
  firstStep,
  visibleSteps,
  onClearPattern,
  onNotePlay,
  onNoteRelease,
  recording,
  onRecordingChange,
  quantize,
  onQuantizeChange,
}: KeyboardPanelProps) {
  return (
    <div className="keyboard-panel">
      <div className="keyboard-panel-toggle">
        <button
          className={mode === 'keyboard' ? 'rack-btn on' : 'rack-btn'}
          onClick={() => onModeChange('keyboard')}
          title="Keyboard"
          aria-label="Keyboard"
          aria-pressed={mode === 'keyboard'}
        >
          Keys
        </button>
        <button
          className={mode === 'piano-roll' ? 'rack-btn on' : 'rack-btn'}
          onClick={() => onModeChange('piano-roll')}
          title="Piano Roll"
          aria-label="Piano Roll"
          aria-pressed={mode === 'piano-roll'}
        >
          Roll
        </button>
        <span className="octave-shift-value">{octaveShift > 0 ? `+${octaveShift}` : octaveShift}</span>
        <button
          className="rack-btn"
          onClick={() => onOctaveShift('down')}
          disabled={octaveShift <= -2}
          title="Shift octave down (Z)"
        >
          Oct -
        </button>
        <button
          className="rack-btn"
          onClick={() => onOctaveShift('up')}
          disabled={octaveShift >= 2}
          title="Shift octave up (X)"
        >
          Oct +
        </button>
        <button
          className={recording ? 'rack-btn on' : 'rack-btn'}
          aria-pressed={recording}
          title="Record: while the song plays, notes played on these keys or the computer keyboard are written where they are played in the bar. Use Click and Count on the top bar to play in time"
          onClick={() => onRecordingChange(!recording)}
        >
          Rec
        </button>
        <label className="keyboard-quantize" title="How firmly a recorded note is moved onto the nearest step. 100% is exactly on it; 0% leaves it where it was played">
          Quantize
          <select aria-label="Record quantize" value={quantize} onChange={(event) => onQuantizeChange(Number(event.target.value))}>
            {QUANTIZE_CHOICES.map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
          </select>
        </label>
      </div>

      {mode === 'keyboard' ? (
        <Keyboard
          onNotePlay={onNotePlay}
          onNoteRelease={onNoteRelease}
          holdEnabled={holdEnabled}
          octaveShift={octaveShift}
          releaseSignal={releaseSignal}
          computerKeyNotes={computerKeyNotes}
          arrowsWalk={selectedStep !== null}
        />
      ) : (
        <PianoRoll
          pattern={pattern}
          lane={lane}
          isPlaying={isPlaying}
          selectedStep={selectedStep}
          octaveShift={octaveShift}
          onStepSelect={onStepSelect}
          onNoteAssign={onNoteAssign}
          onNoteLength={onNoteLength}
          firstStep={firstStep}
          visibleSteps={visibleSteps}
          onClear={onClearPattern}
        />
      )}
    </div>
  );
}
