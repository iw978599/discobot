import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useKnobInteraction } from './useKnobInteraction';
import KnobSheet from './KnobSheet';
import './Fader.css';

// How far the cap travels along its slot, in pixels. Fader.css draws the slot this much longer
// than the cap, and a drag crosses the whole range in the same distance, so the cap stays under
// the pointer that moves it.
export const FADER_TRAVEL = 100;

interface FaderProps {
  // What a screen reader calls it. A fader has no label of its own: its strip is named above it.
  name: string;
  value: number;
  // Where a middle click puts the fader back to.
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue: string;
  onChange: (value: number) => void;
  parseInputValue: (input: string) => number | null;
  hint?: string;
}

// A knob drawn as a fader: the same slider underneath (`useKnobInteraction`), so it is dragged,
// wheeled, stepped with the arrow keys and put back with a middle click exactly as a knob is, and
// a finger's tap opens the same large slider.
export default function Fader({ name, value, defaultValue, min = 0, max = 1, step = 0.01, displayValue, onChange, parseInputValue, hint }: FaderProps) {
  const [localVal, setLocalVal] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const [sheetHost, setSheetHost] = useState<HTMLElement | null>(null);
  const openSheet = () => setSheetHost(rootRef.current?.closest<HTMLElement>('.rack-page') ?? document.body);

  useEffect(() => {
    setLocalVal(value);
    if (!isEditing) setInputValue(displayValue);
  }, [value, displayValue, isEditing]);

  const { normalize, ...interaction } = useKnobInteraction(localVal, min, max, step, (next) => {
    setLocalVal(next);
    onChange(next);
  }, false, openSheet, defaultValue, FADER_TRAVEL);

  const commitInput = useCallback(() => {
    if (!isEditing) return;
    const parsed = parseInputValue(inputValue);
    if (parsed !== null && Number.isFinite(parsed)) {
      const stepped = normalize(Math.max(min, Math.min(max, parsed)));
      setLocalVal(stepped);
      onChange(stepped);
    }
    setIsEditing(false);
  }, [isEditing, parseInputValue, inputValue, min, max, step, onChange]);

  const at = Math.max(0, Math.min(1, (localVal - min) / (max - min)));
  const home = defaultValue === undefined ? null : Math.max(0, Math.min(1, (defaultValue - min) / (max - min)));

  return (
    <div ref={rootRef} className="fader">
      <div
        className="fader-slot"
        {...interaction}
        role="slider"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={localVal}
        aria-valuetext={displayValue}
        title={hint}
        style={{ touchAction: 'none', '--fader-at': at } as CSSProperties}
      >
        <span className="fader-groove" />
        {home !== null && <span className="fader-home" style={{ '--fader-at': home } as CSSProperties} />}
        <span className="fader-cap" />
      </div>
      <input
        className="fader-value"
        aria-label={`${name} value`}
        value={isEditing ? inputValue : displayValue}
        onFocus={() => {
          setIsEditing(true);
          setInputValue(displayValue);
        }}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commitInput}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setIsEditing(false);
            setInputValue(displayValue);
          }
        }}
      />
      {sheetHost && (
        <KnobSheet
          host={sheetHost}
          name={name}
          hint={hint}
          value={localVal}
          min={min}
          max={max}
          step={step}
          display={displayValue}
          normalize={normalize}
          onChange={(next) => { setLocalVal(next); onChange(next); }}
          onClose={() => setSheetHost(null)}
        />
      )}
    </div>
  );
}
