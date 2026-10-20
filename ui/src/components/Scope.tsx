import { useEffect, useRef, useState } from 'react';
import './Scope.css';

type ScopeMode = 'wave' | 'spectrum';
const LOW_HZ = 20, HIGH_HZ = 20000, FLOOR_DB = -100, CEILING_DB = -10;

// A picture of the sound (roadmap 21): the wave as it is now, or its spectrum, read from an analyser
// on every animation frame while the picture is on screen. None of it is React state: like the
// playhead, it changes far too often to render. `source` is asked each frame, since a lane's
// audio is made only when it first sounds; with none, the picture is a flat line.
export default function Scope({ source, label }: { source: () => AnalyserNode | null; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<ScopeMode>('wave');
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const element = canvas.current;
    const pen = element?.getContext('2d');
    if (!element || !pen) return;
    let frame = 0, shown = true, peak = '';
    let wave = new Float32Array(0), spectrum = new Float32Array(0);
    const style = getComputedStyle(element);
    const trace = style.getPropertyValue('--value').trim() || '#f0a030';
    const line = style.getPropertyValue('--edge-faint').trim() || '#444';

    const draw = () => {
      frame = 0;
      if (!shown || document.hidden) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(element.clientWidth * ratio)), height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
      pen.clearRect(0, 0, width, height);
      pen.strokeStyle = line;
      pen.lineWidth = ratio;
      pen.beginPath();
      pen.moveTo(0, height / 2);
      pen.lineTo(width, height / 2);
      pen.stroke();
      const analyser = sourceRef.current();
      let loudest = 0;
      if (analyser) {
        pen.strokeStyle = trace;
        pen.lineWidth = 1.5 * ratio;
        pen.beginPath();
        if (mode === 'wave') {
          if (wave.length !== analyser.fftSize) wave = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(wave);
          // Start where the wave rises through nothing, so a steady note stands still.
          const span = wave.length >> 1;
          let start = 0;
          for (let i = 1; i < span; i++) if (wave[i - 1] <= 0 && wave[i] > 0) { start = i; break; }
          for (let i = 0; i < span; i++) {
            const value = wave[start + i];
            loudest = Math.max(loudest, Math.abs(value));
            const x = i / (span - 1) * width, y = height / 2 - Math.max(-1, Math.min(1, value)) * height * 0.45;
            if (i === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
          }
        } else {
          if (spectrum.length !== analyser.frequencyBinCount) spectrum = new Float32Array(analyser.frequencyBinCount);
          analyser.getFloatFrequencyData(spectrum);
          // Pitch is drawn evenly, an octave the same width low or high, from 20 Hz to 20 kHz.
          const binHz = analyser.context.sampleRate / analyser.fftSize, octaves = Math.log2(HIGH_HZ / LOW_HZ);
          for (let x = 0; x <= width; x += ratio) {
            const bin = Math.min(spectrum.length - 1, Math.round(LOW_HZ * 2 ** (x / width * octaves) / binHz));
            const level = Math.max(0, Math.min(1, (spectrum[bin] - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
            loudest = Math.max(loudest, level);
            const y = height - level * height;
            if (x === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
          }
        }
        pen.stroke();
      }
      // How much there is to see, for a test to read: never React's to render.
      const said = loudest.toFixed(2);
      if (said !== peak) { peak = said; element.dataset.peak = said; }
      frame = requestAnimationFrame(draw);
    };
    const resume = () => { if (shown && !document.hidden && !frame) frame = requestAnimationFrame(draw); };
    // A picture on a unit that is not on show, or in a tab that is hidden, draws nothing.
    const observer = new IntersectionObserver(([entry]) => { shown = entry.isIntersecting; resume(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
    };
  }, [mode]);

  return (
    <div className="scope">
      <canvas ref={canvas} className="scope-canvas" role="img" aria-label={`${label}: ${mode === 'wave' ? 'the wave' : 'the spectrum'} as it sounds now`} data-mode={mode} />
      <div className="scope-modes" role="group" aria-label={`${label} picture`}>
        {(['wave', 'spectrum'] as const).map(entry => (
          <button
            key={entry}
            className={`rack-btn ${mode === entry ? 'on' : ''}`}
            aria-pressed={mode === entry}
            title={entry === 'wave' ? 'Show the wave as it sounds now' : 'Show how loud each pitch is, low on the left'}
            onClick={() => setMode(entry)}
          >
            {entry === 'wave' ? 'Wave' : 'Spectrum'}
          </button>
        ))}
      </div>
    </div>
  );
}
