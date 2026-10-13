import { useState, useMemo, useEffect, useRef } from 'react';
import { keyboardKeyTarget, keyboardNotes, octaveOnShow } from '../services/keyboardKeys';
import './Keyboard.css';

interface KeyboardProps {
  onNotePlay: (note: string) => void;
  onNoteRelease: (note: string) => void;
  octaveShift?: number;
  holdEnabled?: boolean;
  releaseSignal?: boolean;
  // notes held from the computer keyboard, shown pressed alongside clicked ones
  computerKeyNotes?: ReadonlySet<string>;
  // Left and right are walking the lane's selected step (SynthModule), so the keys leave those
  // two alone. Up and down, Home and End still move along the keys.
  arrowsWalk?: boolean;
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

export default function Keyboard({ onNotePlay, onNoteRelease, octaveShift = 0, holdEnabled = false, releaseSignal = false, computerKeyNotes, arrowsWalk = false }: KeyboardProps) {
  const [clickedNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const activeNotes = useMemo(
    () => (computerKeyNotes?.size ? new Set([...clickedNotes, ...computerKeyNotes]) : clickedNotes),
    [clickedNotes, computerKeyNotes],
  );
  const notesRef = useRef(new Set<string>());
  // Each finger on the keys and the note under it, or nothing while it is between or off them.
  const pointers = useRef(new Map<number, string | null>());
  const clickTimers = useRef(new Set<number>());
  const releaseRef = useRef(onNoteRelease);
  releaseRef.current = onNoteRelease;
  const holdRef = useRef(holdEnabled);
  holdRef.current = holdEnabled;
  const releaseAll = () => {
    clickTimers.current.forEach(window.clearTimeout);
    clickTimers.current.clear();
    pointers.current.clear();
    notesRef.current.forEach((note) => releaseRef.current(note));
    notesRef.current.clear();
    setActiveNotes(new Set());
  };

  const baseOctave = 3 + octaveShift;

  const octaves = useMemo(() => [baseOctave, baseOctave + 1, baseOctave + 2], [baseOctave]);

  // On a phone the strip of keys is wider than the screen and shows part of itself: which
  // octave it starts on, and how many further ones there are to move to.
  const stripRef = useRef<HTMLDivElement>(null);
  const [reach, setReach] = useState({ at: 0, max: 0 });
  const showOctave = (index: number) => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = index * (strip.firstElementChild?.getBoundingClientRect().width ?? 0);
  };
  const reachRef = useRef(reach);
  reachRef.current = reach;

  // The keys are one stop for the Tab key: the key the keyboard is on, or was last on while its
  // octave is on show, or else the first key that is. The key that has the focus is the stop
  // wherever the strip is: the strip is moved to it a moment after it takes the focus, and until
  // then a second stop among the keys would be where Tab went.
  const notes = useMemo(() => keyboardNotes(octaves), [octaves]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [keysFocused, setKeysFocused] = useState(false);
  const cursorOctave = cursor ? Math.floor(notes.indexOf(cursor) / 12) : -1;
  const stop = cursor && (keysFocused || (cursorOctave >= reach.at && cursorOctave <= reach.at + 2 - reach.max)) ? cursor : notes[reach.at * 12];
  // A key that takes the focus is brought on show an octave at a time, as the two buttons
  // move the strip, so the strip never rests part of the way along.
  const reveal = (note: string) => {
    const { at, max } = reachRef.current;
    const index = Math.floor(notes.indexOf(note) / 12);
    if (max <= 0 || index < 0) return;
    const next = octaveOnShow(index, at, 3 - max);
    showOctave(next);
    // Said here as well as read back from the scroll, which is heard a frame later.
    setReach(now => (now.at === next ? now : { ...now, at: next }));
  };

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

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const octaveWidth = () => strip.firstElementChild?.getBoundingClientRect().width || 1;
    let at = 0, max = -1, width = -1;
    const read = () => {
      if (strip.clientWidth === 0) return;
      at = Math.min(Math.max(0, max), Math.round(strip.scrollLeft / octaveWidth()));
      setReach(now => (now.at === at && now.max === Math.max(0, max) ? now : { at, max: Math.max(0, max) }));
    };
    const settle = () => {
      const now = strip.clientWidth;
      // The keys have changed size under the fingers: their unit was switched away on the bar
      // (it is hidden, not removed, so no pointer event says so) or the phone was turned. A
      // finger that was on a key is no longer on that key, so what it held is let go.
      if (now !== width && pointers.current.size > 0) {
        const held = [...pointers.current.values()];
        pointers.current.clear();
        if (!holdRef.current) {
          for (const note of held) if (note && notesRef.current.delete(note)) releaseRef.current(note);
          setActiveNotes(new Set(notesRef.current));
        }
      }
      width = now;
      if (now === 0) return;
      const reachable = Math.max(0, Math.round((strip.scrollWidth - now) / octaveWidth()));
      // First shown, or the number of octaves across has changed: start on the middle one.
      if (reachable !== max) at = Math.min(1, reachable);
      max = reachable;
      strip.scrollLeft = at * octaveWidth();
      read();
    };
    const observer = new ResizeObserver(settle);
    observer.observe(strip);
    strip.addEventListener('scroll', read);
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', read);
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

  const fingerOn = (note: string) => [...pointers.current.values()].includes(note);
  // A finger has left the key it was on, by lifting or by sliding off. The note stops unless
  // another finger is on the same key.
  const leave = (pointerId: number) => {
    const note = pointers.current.get(pointerId);
    pointers.current.delete(pointerId);
    if (note && !fingerOn(note)) handleNoteUp(note);
  };

  const keyEvents = (note: string) => ({
    'aria-label': `Play ${note}`,
    'aria-pressed': activeNotes.has(note),
    'data-note': note,
    tabIndex: note === stop ? 0 : -1,
    style: { touchAction: 'none' },
    onFocus: () => {
      setCursor(note);
      setKeysFocused(true);
      reveal(note);
    },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Focusing may scroll a key into view, which must not happen under a finger.
      event.currentTarget.focus({ preventScroll: event.pointerType !== 'mouse' });
      event.currentTarget.setPointerCapture(event.pointerId);
      const shared = fingerOn(note);
      pointers.current.set(event.pointerId, note);
      // A second finger on a key that is already held adds nothing, and with hold on must not
      // switch the note off again.
      if (!shared) handleNoteDown(note);
    },
    // A finger that slides plays each key it crosses. Its events go on arriving at the key it
    // first pressed, so the key under it is looked up. A mouse holds the key it pressed, as it
    // always has, and with hold on a slide would switch every key it crossed.
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' || holdEnabled) return;
      const from = pointers.current.get(event.pointerId);
      if (from === undefined) return;
      const key = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.key');
      const to = key && stripRef.current?.contains(key) ? key.dataset.note ?? null : null;
      if (to === from) return;
      pointers.current.set(event.pointerId, null);
      if (from && !fingerOn(from)) handleNoteUp(from);
      const shared = to !== null && fingerOn(to);
      pointers.current.set(event.pointerId, to);
      if (to && !shared) handleNoteDown(to);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => leave(event.pointerId),
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => leave(event.pointerId),
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => leave(event.pointerId),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if ([' ', 'Enter'].includes(event.key)) {
        event.preventDefault();
        if (!event.repeat) handleNoteDown(note);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      if (sideways && arrowsWalk) return;
      // Up is the next key to the right, as it is the higher note.
      const way = event.key === 'ArrowUp' ? 'ArrowRight' : event.key === 'ArrowDown' ? 'ArrowLeft' : event.key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(way)) return;
      // Prevented even at the last key, so the page does not scroll and the lane's own arrow
      // keys do not act for a key pressed here.
      event.preventDefault();
      const next = keyboardKeyTarget(way, notes, note);
      if (next) stripRef.current?.querySelector<HTMLElement>(`[data-note="${next}"]`)?.focus({ preventScroll: true });
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      handleNoteUp(note);
    },
    // A second finger takes the focus from the first one's key, which is still held.
    onBlur: () => { setKeysFocused(false); if (!fingerOn(note)) handleNoteUp(note); },
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

  const rangeLabel = `${WHITE_KEYS[0]}${baseOctave + reach.at} - ${WHITE_KEYS[WHITE_KEYS.length - 1]}${baseOctave + reach.at + 2 - reach.max}`;

  return (
    <div className="keyboard-container">
      <div className="keyboard-header">
        <h2>Keyboard</h2>
        {reach.max > 0 && (
          <button className="rack-btn keyboard-reach" aria-label="Lower keys" disabled={reach.at <= 0} onClick={() => showOctave(reach.at - 1)}>◀</button>
        )}
        <span className="keyboard-range" title="Computer keyboard: A–L row plays white keys, W E T Y U O P black keys, Z and X shift the octave">{rangeLabel}</span>
        {reach.max > 0 && (
          <button className="rack-btn keyboard-reach" aria-label="Higher keys" disabled={reach.at >= reach.max} onClick={() => showOctave(reach.at + 1)}>▶</button>
        )}
      </div>
      <div className="keyboard" ref={stripRef} role="group" aria-label="Piano keys" onContextMenu={(event) => { if (pointers.current.size > 0 || ['touch', 'pen'].includes((event.nativeEvent as PointerEvent).pointerType)) event.preventDefault(); }}>
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
