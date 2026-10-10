import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ensureAudioReady, getAudioContext, setMasterMuted, setMasterVolume } from '../hooks/browserAudio';
import { useSynthAudio } from '../hooks/useSynthAudio';
import { useDrumAudio } from '../hooks/useDrumAudio';
import { BrowserTransport, type TransportTick } from '../services/browserTransport';
import {
  KIDS_LEAVE_HOLD_MS, KIDS_PADS, KIDS_SOUNDS, KIDS_STEPS, KIDS_TEMPOS, KIDS_VOLUME,
  blankKids, kidsDrumSettings, leaveKidsMode, loadKids, saveKids, stepNearest, withNote, type KidsStep,
} from '../services/kids';
import './kids.css';

// A press that acts the moment it lands, not when the finger lifts: a pad has to sound at once.
const press = (action: () => void) => ({
  onPointerDown: (event: PointerEvent) => { if (event.button === 0) action(); },
  onKeyDown: (event: KeyboardEvent) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
    event.preventDefault();
    action();
  },
});

// The way out is for the adult: it only works when held, which a small child rarely does.
function LeaveButton() {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(leaveKidsMode, KIDS_LEAVE_HOLD_MS);
  };
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => cancel, []);
  return (
    <button
      className={`kids-leave ${holding ? 'holding' : ''}`}
      aria-label="Leave kids mode: press and hold for three seconds"
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onBlur={cancel}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); start(); } }}
      onKeyUp={cancel}
    >
      <span className="kids-leave-fill" style={{ transitionDuration: holding ? `${KIDS_LEAVE_HOLD_MS}ms` : '0ms' }} />
      <span className="kids-leave-text">Hold to leave</span>
    </button>
  );
}

// Kids mode: nine big pads that sound when touched, a few sounds chosen by picture, and one
// play button that loops what has been tapped. There is nothing here to read, type or open,
// and nothing that reaches the projects, the account or any other site.
export default function KidsPage() {
  const [state, setState] = useState(loadKids);
  const [playing, setPlaying] = useState(false);
  // The step of the loop being played, for the lights.
  const [position, setPosition] = useState(-1);
  const synth = useSynthAudio(), drums = useDrumAudio();
  const stateRef = useRef(state);
  stateRef.current = state;
  const transportRef = useRef<BrowserTransport | null>(null);
  const lastStep = useRef<KidsStep | null>(null);
  // The step each pad was last tapped on by hand. The loop leaves that one alone the first
  // time round, because the tap has already played it.
  const tapped = useRef(new Map<number, number>());

  useEffect(() => {
    setMasterMuted(false);
    setMasterVolume(KIDS_VOLUME);
    return () => { transportRef.current?.stop(); };
  }, []);
  useEffect(() => { saveKids(state); }, [state]);

  const sound = (pad: number, time?: number, length = 0.35) => {
    const entry = KIDS_PADS[pad];
    if ('drum' in entry) void drums.playDrumHit(entry.drum, kidsDrumSettings(entry.drum), 1, time);
    else void synth.playNote(entry.note, KIDS_SOUNDS[stateRef.current.sound].params, length, 0.9, false, undefined, KIDS_TEMPOS[stateRef.current.tempo], 1, time);
  };

  const tickRef = useRef<(tick: TransportTick) => void>(() => {});
  tickRef.current = (tick) => {
    // The transport ticks in 32nd notes; a step here is an eighth.
    if (tick.step % 4 !== 0) return;
    const count = (tick.bar * 32 + tick.step) / 4, step = count % KIDS_STEPS, duration = tick.duration * 4;
    lastStep.current = { count, time: tick.time, duration };
    stateRef.current.notes.forEach((row, pad) => {
      if (row[step] && tapped.current.get(pad) !== count) sound(pad, tick.time, duration * 0.9);
    });
    setPosition(step);
  };

  const togglePlay = async () => {
    if (playing) {
      transportRef.current?.stop();
      synth.stopAllNotes();
      drums.stopAllNotes();
      lastStep.current = null;
      tapped.current.clear();
      setPlaying(false);
      setPosition(-1);
      return;
    }
    if (!await ensureAudioReady()) return;
    transportRef.current ??= new BrowserTransport(
      () => getAudioContext().currentTime,
      () => KIDS_TEMPOS[stateRef.current.tempo],
      tick => tickRef.current(tick),
    );
    transportRef.current.start();
    setPlaying(true);
  };

  // A pad sounds at once. While the loop plays, the tap is also kept on the nearest step, so it comes round again.
  const tap = (pad: number) => {
    sound(pad);
    const last = lastStep.current;
    if (!playing || !last) return;
    const count = stepNearest(last, getAudioContext().currentTime);
    tapped.current.set(pad, count);
    setState(current => withNote(current, pad, count % KIDS_STEPS));
  };

  const chooseSound = (index: number) => {
    setState(current => ({ ...current, sound: index }));
    void synth.playNote('G4', KIDS_SOUNDS[index].params, 0.35, 0.9);
  };

  return (
    <main className="kids" aria-label="Kids mode" onContextMenu={(event) => event.preventDefault()}>
      <div className="kids-top">
        <div className="kids-sounds" role="group" aria-label="Sound">
          {KIDS_SOUNDS.map((entry, index) => (
            <button key={entry.label} className={`kids-round ${index === state.sound ? 'on' : ''}`} aria-label={entry.label} aria-pressed={index === state.sound} {...press(() => chooseSound(index))}>
              {entry.picture}
            </button>
          ))}
        </div>
        <LeaveButton />
      </div>

      <div className="kids-pads" role="group" aria-label="Pads">
        {KIDS_PADS.map((pad, index) => (
          <button
            key={pad.label}
            className={`kids-pad ${position >= 0 && state.notes[index][position] ? 'lit' : ''}`}
            style={{ background: pad.color }}
            aria-label={pad.label}
            {...press(() => tap(index))}
          >
            {pad.picture}
          </button>
        ))}
      </div>

      <div className="kids-dots" aria-hidden="true">
        {Array.from({ length: KIDS_STEPS }, (_, step) => (
          <span key={step} className={`${state.notes.some(row => row[step]) ? 'on' : ''} ${step === position ? 'now' : ''}`} />
        ))}
      </div>

      <div className="kids-bottom">
        <button
          className="kids-round"
          aria-label={state.tempo === 'slow' ? 'Slow. Press to go faster' : 'Fast. Press to go slower'}
          onClick={() => setState(current => ({ ...current, tempo: current.tempo === 'slow' ? 'fast' : 'slow' }))}
        >
          {state.tempo === 'slow' ? '🐢' : '🐇'}
        </button>
        <button className={`kids-play ${playing ? 'on' : ''}`} aria-label={playing ? 'Stop' : 'Play'} aria-pressed={playing} onClick={() => { void togglePlay(); }}>
          {playing ? '■' : '▶'}
        </button>
        <button className="kids-round" aria-label="Start again" onClick={() => { tapped.current.clear(); setState(current => ({ ...blankKids(), sound: current.sound, tempo: current.tempo })); }}>
          🧽
        </button>
      </div>
    </main>
  );
}
