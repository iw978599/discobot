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
}

export default function DrumKnob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  displayValue,
  onChange,
}: DrumKnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

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
  }, [localVal, min, max, step, onChange]);

  const svgDeg = -240 + pct * 300;

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
      <span className="drum-knob-value">{displayValue ?? localVal.toFixed(2)}</span>
    </div>
  );
}
