import { useCallback, useEffect, useRef, useState } from 'react';

// Physical key positions, so the piano layout is the same on any keyboard language.
const KEY_SEMITONES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The A key is the C in the middle of the on-screen keyboard.
export function noteForKey(code: string, octaveShift: number): string | null {
  const semitone = KEY_SEMITONES[code];
  if (semitone === undefined) return null;
  return `${NOTE_NAMES[semitone % 12]}${4 + octaveShift + Math.floor(semitone / 12)}`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return !['range', 'checkbox', 'radio', 'button', 'file'].includes((target as HTMLInputElement).type);
}

interface ComputerKeyboardTarget {
  synthId: number;
  octaveShift: number;
  hold: boolean;
}

interface ComputerKeyboardOptions {
  target: ComputerKeyboardTarget | null;
  // Changing this releases every held key: lane switch, transport stop, hold switched off.
  resetKey: string;
  onNoteDown: (synthId: number, note: string) => void;
  onNoteUp: (synthId: number, note: string) => void;
  onOctave: (synthId: number, direction: 'up' | 'down') => void;
}

// Plays the selected lane from the computer keyboard: the A row is white keys, the row
// above is black keys, Z and X shift the octave. Returns the notes currently held.
export function useComputerKeyboard(options: ComputerKeyboardOptions): ReadonlySet<string> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const heldRef = useRef(new Map<string, { synthId: number; note: string }>());
  const [heldNotes, setHeldNotes] = useState<ReadonlySet<string>>(new Set());

  const publish = useCallback(() => {
    setHeldNotes(new Set([...heldRef.current.values()].map(entry => entry.note)));
  }, []);

  const releaseAll = useCallback(() => {
    if (heldRef.current.size === 0) return;
    for (const entry of heldRef.current.values()) optionsRef.current.onNoteUp(entry.synthId, entry.note);
    heldRef.current.clear();
    publish();
  }, [publish]);

  useEffect(() => { releaseAll(); }, [options.resetKey, releaseAll]);

  useEffect(() => {
    const release = (code: string) => {
      const entry = heldRef.current.get(code);
      if (!entry) return;
      heldRef.current.delete(code);
      optionsRef.current.onNoteUp(entry.synthId, entry.note);
      publish();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { target, onNoteDown, onOctave } = optionsRef.current;
      if (!target || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      if (event.code === 'KeyZ' || event.code === 'KeyX') {
        event.preventDefault();
        releaseAll();
        onOctave(target.synthId, event.code === 'KeyX' ? 'up' : 'down');
        return;
      }
      const note = noteForKey(event.code, target.octaveShift);
      if (!note) return;
      event.preventDefault();
      if (heldRef.current.has(event.code)) {
        // With hold on, a second press of the same key lets the note go.
        if (target.hold) release(event.code);
        return;
      }
      heldRef.current.set(event.code, { synthId: target.synthId, note });
      publish();
      onNoteDown(target.synthId, note);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (optionsRef.current.target?.hold) return;
      release(event.code);
    };
    const onHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHidden);
      releaseAll();
    };
  }, [publish, releaseAll]);

  return heldNotes;
}
