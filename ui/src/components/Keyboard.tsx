import { useState, useMemo, useEffect } from 'react';
import './Keyboard.css';

interface KeyboardProps {
  onNotePlay: (note: string) => void;
  onNoteRelease: (note: string) => void;
  octaveShift?: number;
  holdEnabled?: boolean;
}

const WHITE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_KEYS = [
  { note: 'C#', offset: 0.7 },
  { note: 'D#', offset: 1.7 },
  null,
  { note: 'F#', offset: 3.7 },
  { note: 'G#', offset: 4.7 },
  { note: 'A#', offset: 5.7 },
  null,
];

export default function Keyboard({ onNotePlay, onNoteRelease, octaveShift = 0, holdEnabled = false }: KeyboardProps) {
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());

  const baseOctave = 3 + octaveShift;

  const octaves = useMemo(() => [baseOctave, baseOctave + 1, baseOctave + 2], [baseOctave]);

  useEffect(() => {
    if (holdEnabled || activeNotes.size === 0) return;
    activeNotes.forEach((note) => onNoteRelease(note));
    setActiveNotes(new Set());
  }, [holdEnabled, activeNotes, onNoteRelease]);

  const handleNoteDown = (note: string) => {
    if (activeNotes.has(note)) {
      if (holdEnabled) {
        setActiveNotes((prev) => {
          const next = new Set(prev);
          next.delete(note);
          return next;
        });
        onNoteRelease(note);
      }
      return;
    }
    setActiveNotes((prev) => new Set(prev).add(note));
    onNotePlay(note);
  };

  const handleNoteUp = (note: string) => {
    if (holdEnabled) return;
    setActiveNotes((prev) => {
      if (!prev.has(note)) return prev;
      const next = new Set(prev);
      next.delete(note);
      onNoteRelease(note);
      return next;
    });
  };

  const rangeLabel = `${WHITE_KEYS[0]}${baseOctave} - ${WHITE_KEYS[WHITE_KEYS.length - 1]}${baseOctave + 2}`;

  return (
    <div className="keyboard-container">
      <div className="keyboard-header">
        <h2>Keyboard</h2>
        <span className="keyboard-range">{rangeLabel}</span>
      </div>
      <div className="keyboard">
        {octaves.map((octave) => (
          <div key={octave} className="octave">
            <div className="white-keys">
              {WHITE_KEYS.map((note) => {
                const fullNote = `${note}${octave}`;
                return (
                  <button
                    key={fullNote}
                    className={`key white ${
                      activeNotes.has(fullNote) ? 'active' : ''
                    }`}
                    onMouseDown={() => handleNoteDown(fullNote)}
                    onMouseUp={() => handleNoteUp(fullNote)}
                    onMouseLeave={() => handleNoteUp(fullNote)}
                  >
                    <span className="key-label">{note}</span>
                  </button>
                );
              })}
            </div>
            <div className="black-keys">
              {BLACK_KEYS.map((black, index) => {
                if (!black) return <div key={index} className="black-spacer" />;
                const fullNote = `${black.note}${octave}`;
                return (
                  <button
                    key={fullNote}
                    className={`key black ${
                      activeNotes.has(fullNote) ? 'active' : ''
                    }`}
                    style={{ left: `${black.offset * 14.28}%` }}
                    onMouseDown={() => handleNoteDown(fullNote)}
                    onMouseUp={() => handleNoteUp(fullNote)}
                    onMouseLeave={() => handleNoteUp(fullNote)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
