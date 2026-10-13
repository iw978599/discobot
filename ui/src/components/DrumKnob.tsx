import { useCallback, useEffect, useRef, useState } from 'react';
import { useKnobInteraction } from './useKnobInteraction';
import KnobSheet from './KnobSheet';
import './DrumKnob.css';

interface DrumKnobProps {
  label: string;
  value: number;
  // Where a middle click puts the knob back to.
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue?: string;
  onChange: (value: number) => void;
  parseInputValue?: (input: string) => number | null;
  title?: string;
  ariaLabel?: string;
}

export default function DrumKnob({
  label,
  value,
  defaultValue,
  min = 0,
  max = 1,
  step = 0.01,
  displayValue,
  onChange,
  parseInputValue,
  title,
  ariaLabel = label,
}: DrumKnobProps) {
  const [localVal, setLocalVal] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  // Set while the large slider is open: the page it is put on.
  const [sheetHost, setSheetHost] = useState<HTMLElement | null>(null);
  const openSheet = () => setSheetHost(rootRef.current?.closest<HTMLElement>('.rack-page') ?? document.body);

  const computedDisplay = displayValue ?? localVal.toFixed(2);

  useEffect(() => {
    setLocalVal(value);
    if (!isEditing) setInputValue(displayValue ?? value.toFixed(2));
  }, [value, displayValue, isEditing]);

  const pct = (localVal - min) / (max - min);

  const { normalize, ...interaction } = useKnobInteraction(localVal, min, max, step, (next) => {
    setLocalVal(next);
    onChange(next);
  }, false, openSheet, defaultValue);

  const svgDeg = -240 + pct * 300;

  const commitInput = useCallback(() => {
    if (!isEditing) return;
    const parsed = parseInputValue
      ? parseInputValue(inputValue)
      : Number.parseFloat(inputValue.replace(/[^0-9+-.]/g, ''));
    if (Number.isFinite(parsed)) {
      const newVal = Math.max(min, Math.min(max, parsed as number));
      const stepped = normalize(newVal);
      setLocalVal(stepped);
      onChange(stepped);
    }
    setIsEditing(false);
  }, [isEditing, parseInputValue, inputValue, min, max, step, onChange]);

  return (
    <div ref={rootRef} className="drum-knob">
      <div
        className="drum-knob-rotary"
        {...interaction}
        role="slider"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={localVal}
        aria-valuetext={computedDisplay}
        style={{ touchAction: 'none' }}
      >
        <svg viewBox="0 0 44 44" className="drum-knob-svg">
          <circle cx="22" cy="22" r="18" fill="#2a2a2a" stroke="#4a4a4a" strokeWidth="2" />
          <circle cx="22" cy="22" r="14" fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="1" />
          <line
            x1="22"
            y1="22"
            x2={22 + 12 * Math.cos((svgDeg * Math.PI) / 180)}
            y2={22 + 12 * Math.sin((svgDeg * Math.PI) / 180)}
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx={22 + 9 * Math.cos((svgDeg * Math.PI) / 180)} cy={22 + 9 * Math.sin((svgDeg * Math.PI) / 180)} r="2.5" fill="#f59e0b" />
        </svg>
      </div>
      <span className="drum-knob-label" title={title}>{label}</span>
      <input
        className="drum-knob-value-input"
        aria-label={`${ariaLabel} value`}
        value={isEditing ? inputValue : computedDisplay}
        onFocus={() => {
          setIsEditing(true);
          setInputValue(computedDisplay);
        }}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commitInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setIsEditing(false);
            setInputValue(computedDisplay);
          }
        }}
      />
      {sheetHost && (
        <KnobSheet
          host={sheetHost}
          name={ariaLabel}
          hint={title}
          value={localVal}
          min={min}
          max={max}
          step={step}
          display={computedDisplay}
          normalize={normalize}
          onChange={(next) => { setLocalVal(next); onChange(next); }}
          onClose={() => setSheetHost(null)}
        />
      )}
    </div>
  );
}
