import { useRef, useCallback, useEffect, useState } from 'react';
import './DrumKnob.css';

interface DrumKnobProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue?: string;
  onChange: (value: number) => void;
  parseInputValue?: (input: string) => number | null;
}

export default function DrumKnob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  displayValue,
  onChange,
  parseInputValue,
}: DrumKnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [localVal, setLocalVal] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const computedDisplay = displayValue ?? localVal.toFixed(2);

  useEffect(() => {
    setLocalVal(value);
    if (!isEditing) setInputValue(displayValue ?? value.toFixed(2));
  }, [value, displayValue, isEditing]);

  const pct = (localVal - min) / (max - min);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startVal.current = localVal;

    const handleMouseMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (startY.current - me.clientY) / 150;
      const range = max - min;
      const newVal = Math.max(min, Math.min(max, startVal.current + delta * range));
      const stepped = Math.round((newVal - min) / step) * step + min;
      setLocalVal(stepped);
      onChange(stepped);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [localVal, min, max, step, onChange]);

  const svgDeg = -240 + pct * 300;

  const commitInput = useCallback(() => {
    const parsed = parseInputValue
      ? parseInputValue(inputValue)
      : Number.parseFloat(inputValue.replace(/[^0-9+-.]/g, ''));
    if (Number.isFinite(parsed)) {
      const newVal = Math.max(min, Math.min(max, parsed as number));
      const stepped = Math.round((newVal - min) / step) * step + min;
      setLocalVal(stepped);
      onChange(stepped);
    }
    setIsEditing(false);
  }, [parseInputValue, inputValue, min, max, step, onChange]);

  return (
    <div className="drum-knob">
      <div
        ref={knobRef}
        className="drum-knob-rotary"
        onMouseDown={handleMouseDown}
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
      <span className="drum-knob-label">{label}</span>
      <input
        className="drum-knob-value-input"
        value={isEditing ? inputValue : computedDisplay}
        onFocus={() => {
          setIsEditing(true);
          setInputValue(computedDisplay);
        }}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commitInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitInput();
          if (e.key === 'Escape') {
            setIsEditing(false);
            setInputValue(computedDisplay);
          }
        }}
      />
    </div>
  );
}
