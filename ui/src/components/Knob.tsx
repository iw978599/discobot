/**
 * Reusable Knob component for synthesizer controls
 * Based on DrumKnob but more generic and flexible
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import './Knob.css';

interface KnobProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue?: string;
  onChange: (value: number) => void;
  size?: 'small' | 'medium' | 'large';
  color?: string;
  disabled?: boolean;
  tooltip?: string;
  parseInputValue?: (input: string) => number | null;
}

export default function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  displayValue,
  onChange,
  size = 'medium',
  color = '#f59e0b',
  disabled = false,
  tooltip,
  parseInputValue,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [localVal, setLocalVal] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const computedDisplay = displayValue ?? localVal.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

  useEffect(() => {
    setLocalVal(value);
    if (!isEditing) setInputValue(displayValue ?? value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2));
  }, [value, displayValue, step, isEditing]);

  const pct = (localVal - min) / (max - min);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
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
  }, [localVal, min, max, step, onChange, disabled]);

  const svgDeg = -240 + pct * 300;

  const sizes = {
    small: { svg: 36, outer: 16, inner: 12, line: 10, dot: 2 },
    medium: { svg: 50, outer: 20, inner: 16, line: 14, dot: 2.5 },
    large: { svg: 64, outer: 26, inner: 21, line: 18, dot: 3 },
  };

  const s = sizes[size];
  const center = s.svg / 2;

  const commitInput = useCallback(() => {
    if (disabled) {
      setIsEditing(false);
      return;
    }
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
  }, [disabled, inputValue, parseInputValue, min, max, step, onChange]);

  return (
    <div className={`knob knob-${size} ${disabled ? 'knob-disabled' : ''}`}>
      <div
        ref={knobRef}
        className="knob-rotary"
        onMouseDown={handleMouseDown}
      >
        <svg viewBox={`0 0 ${s.svg} ${s.svg}`} className="knob-svg">
          <circle
            cx={center}
            cy={center}
            r={s.outer}
            fill="#2a2a2a"
            stroke="#4a4a4a"
            strokeWidth="2"
          />
          <circle
            cx={center}
            cy={center}
            r={s.inner}
            fill="#1a1a1a"
            stroke="#3a3a3a"
            strokeWidth="1"
          />
          <line
            x1={center}
            y1={center}
            x2={center + s.line * Math.cos((svgDeg * Math.PI) / 180)}
            y2={center + s.line * Math.sin((svgDeg * Math.PI) / 180)}
            stroke={disabled ? '#666' : color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx={center + (s.line - 2) * Math.cos((svgDeg * Math.PI) / 180)}
            cy={center + (s.line - 2) * Math.sin((svgDeg * Math.PI) / 180)}
            r={s.dot}
            fill={disabled ? '#666' : color}
          />
        </svg>
      </div>

      <span className="knob-label" title={tooltip}>{label}</span>
      <input
        className="knob-value-input"
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
        disabled={disabled}
      />
    </div>
  );
}
