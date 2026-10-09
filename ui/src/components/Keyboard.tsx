import { useState, useMemo, useEffect, useRef } from 'react';
import './Keyboard.css';

interface KeyboardProps {
  onNotePlay: (note: string) => void;
  onNoteRelease: (note: string) => void;
  octaveShift?: number;
  holdEnabled?: boolean;
  releaseSignal?: boolean;
  // notes held from the computer keyboard, shown pressed alongside clicked ones
  computerKeyNotes?: ReadonlySet<string>;
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

export default function Keyboard({ onNotePlay, onNoteRelease, octaveShift = 0, holdEnabled = false, releaseSignal = false, computerKeyNotes }: KeyboardProps) {
  const [clickedNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const activeNotes = useMemo(
    () => (computerKeyNotes?.size ? new Set([...clickedNotes, ...computerKeyNotes]) : clickedNotes),
    [clickedNotes, computerKeyNotes],
  );
  const notesRef = useRef(new Set<string>());
  const clickTimers = useRef(new Set<number>());
  const releaseRef = useRef(onNoteRelease);
  releaseRef.current = onNoteRelease;
  const releaseAll = () => {
    clickTimers.current.forEach(window.clearTimeout);
    clickTimers.current.clear();
    notesRef.current.forEach((note) => releaseRef.current(note));
    notesRef.current.clear();
    setActiveNotes(new Set());
  };

  const baseOctave = 3 + octaveShift;

  const octaves = useMemo(() => [baseOctave, baseOctave + 1, baseOctave + 2], [baseOctave]);

  useEffect(() => {
    if (!holdEnabled) releaseAll();
  }, [holdEnabled]);

  useEffect(() => {
    releaseAll();
  }, [releaseSignal, octaveShift]);

  useEffect(() => {
    const cancel = () => releaseAll();
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clickTimers.current.forEach(window.clearTimeout);
      clickTimers.current.clear();
      notesRef.current.forEach((note) => releaseRef.current(note));
      notesRef.current.clear();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const handleNoteDown = (note: string) => {
    if (notesRef.current.has(note)) {
      if (holdEnabled) {
        notesRef.current.delete(note);
        setActiveNotes(new Set(notesRef.current));
        onNoteRelease(note);
      }
      return;
    }
    notesRef.current.add(note);
    setActiveNotes(new Set(notesRef.current));
    onNotePlay(note);
  };

  const handleNoteUp = (note: string) => {
    if (holdEnabled) return;
    if (!notesRef.current.delete(note)) return;
    setActiveNotes(new Set(notesRef.current));
    onNoteRelease(note);
  };

  const keyEvents = (note: string) => ({
    'aria-label': `Play ${note}`,
    'aria-pressed': activeNotes.has(note),
    style: { touchAction: 'none' },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      handleNoteDown(note);
    },
    onPointerUp: () => handleNoteUp(note),
    onPointerCancel: () => {
      if (notesRef.current.delete(note)) {
        onNoteRelease(note);
        setActiveNotes(new Set(notesRef.current));
      }
    },
    onLostPointerCapture: () => handleNoteUp(note),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) handleNoteDown(note);
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      handleNoteUp(note);
    },
    onBlur: () => handleNoteUp(note),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0) return;
      handleNoteDown(note);
      if (holdEnabled) return;
      const timer = window.setTimeout(() => {
        clickTimers.current.delete(timer);
        handleNoteUp(note);
      }, 180);
      clickTimers.current.add(timer);
    },
  });

  const rangeLabel = `${WHITE_KEYS[0]}${baseOctave} - ${WHITE_KEYS[WHITE_KEYS.length - 1]}${baseOctave + 2}`;

  return (
    <div className="keyboard-container">
      <div className="keyboard-header">
        <h2>Keyboard</h2>
        <span className="keyboard-range" title="Computer keyboard: A–L row plays white keys, W E T Y U O P black keys, Z and X shift the octave">{rangeLabel}</span>
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
                    {...keyEvents(fullNote)}
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
                    {...keyEvents(fullNote)}
                    style={{ left: `${black.offset * 14.28}%`, touchAction: 'none' }}
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
