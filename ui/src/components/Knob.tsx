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
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [localVal, setLocalVal] = useState(value);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

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
      const stepped = Math.round(newVal / step) * step;
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

  // Rotation: min at right (~60deg), max at left (~120deg) across 300° sweep
  const svgDeg = 60 - pct * 300;

  const sizes = {
    small: { svg: 36, outer: 16, inner: 12, line: 10, dot: 2 },
    medium: { svg: 50, outer: 20, inner: 16, line: 14, dot: 2.5 },
    large: { svg: 64, outer: 26, inner: 21, line: 18, dot: 3 },
  };

  const s = sizes[size];
  const center = s.svg / 2;

  return (
    <div
      className={`knob knob-${size} ${disabled ? 'knob-disabled' : ''}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        ref={knobRef}
        className="knob-rotary"
        onMouseDown={handleMouseDown}
      >
        <svg viewBox={`0 0 ${s.svg} ${s.svg}`} className="knob-svg">
          {/* Outer ring */}
          <circle
            cx={center}
            cy={center}
            r={s.outer}
            fill="#2a2a2a"
            stroke="#4a4a4a"
            strokeWidth="2"
          />

          {/* Inner ring */}
          <circle
            cx={center}
            cy={center}
            r={s.inner}
            fill="#1a1a1a"
            stroke="#3a3a3a"
            strokeWidth="1"
          />

          {/* Indicator line */}
          <line
            x1={center}
            y1={center}
            x2={center + s.line * Math.cos((svgDeg * Math.PI) / 180)}
            y2={center + s.line * Math.sin((svgDeg * Math.PI) / 180)}
            stroke={disabled ? '#666' : color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Indicator dot */}
          <circle
            cx={center + (s.line - 2) * Math.cos((svgDeg * Math.PI) / 180)}
            cy={center + (s.line - 2) * Math.sin((svgDeg * Math.PI) / 180)}
            r={s.dot}
            fill={disabled ? '#666' : color}
          />
        </svg>
      </div>

      <span className="knob-label">{label}</span>
      <span className="knob-value">{displayValue ?? localVal.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}</span>

      {tooltip && showTooltip && (
        <div className="knob-tooltip">{tooltip}</div>
      )}
    </div>
  );
}
