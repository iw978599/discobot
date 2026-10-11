import { createPortal } from 'react-dom';
import Dialog from '../rack/Dialog';

interface KnobSheetProps {
  // Where the sheet is put: the page, so it lies over the rack whatever unit the knob is in.
  host: HTMLElement;
  name: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  // The knob's own rounding to its steps and limits.
  normalize: (value: number) => number;
  onChange: (value: number) => void;
  onClose: () => void;
}

// A knob for a finger. A knob is a small thing to turn with a fingertip that is also covering
// it, so a tap on one opens this instead: its value in large figures over a slider as wide as
// the screen, with a button either side to move it one step. It is the same value and the same
// handler as the knob, which goes on turning underneath as the slider moves.
export default function KnobSheet({ host, name, hint, value, min, max, step, display, normalize, onChange, onClose }: KnobSheetProps) {
  return createPortal(
    <Dialog title={name} closeLabel={`Close ${name}`} onClose={onClose} sheet initialFocus="input">
      <output className="knob-sheet-value">{display}</output>
      <div className="knob-sheet-row">
        <button className="rack-btn" aria-label={`Lower ${name}`} disabled={value <= min} onClick={() => onChange(normalize(value - step))}>−</button>
        <input
          type="range"
          aria-label={name}
          aria-valuetext={display}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(normalize(Number(event.target.value)))}
        />
        <button className="rack-btn" aria-label={`Raise ${name}`} disabled={value >= max} onClick={() => onChange(normalize(value + step))}>+</button>
      </div>
      {hint && <p className="knob-sheet-hint">{hint}</p>}
    </Dialog>,
    host,
  );
}
