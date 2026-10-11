import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { ensureAudioReady, getAudioContext, setMasterMuted, setMasterVolume } from '../hooks/browserAudio';
import { useSynthAudio } from '../hooks/useSynthAudio';
import { useDrumAudio } from '../hooks/useDrumAudio';
import { BrowserTransport, type TransportTick } from '../services/browserTransport';
import { playhead } from '../services/playhead';
import {
  KIDS_BEAT_ROWS, KIDS_BEAT_STEPS, KIDS_LEAVE_HOLD_MS, KIDS_PADS, KIDS_PAD_ORDER, KIDS_SOUNDS, KIDS_STEPS, KIDS_TEMPOS, KIDS_VOLUME,
  blankKids, kidsDrumSettings, leaveKidsMode, loadKids, padSounds, saveKids, stepNearest, withBeatToggled, withNote,
  type KidsScreen, type KidsStep,
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

// The two activities are chosen by a drawing of what each looks like: four pads, and a grid
// with some of its holes filled.
const SCREENS: Array<{ id: KidsScreen; label: string; picture: ReactElement }> = [
  { id: 'pads', label: 'Play the pads', picture: (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect x="3" y="3" width="15" height="15" rx="4" fill="#e5484d" />
      <rect x="22" y="3" width="15" height="15" rx="4" fill="#f5c518" />
      <rect x="3" y="22" width="15" height="15" rx="4" fill="#46a758" />
      <rect x="22" y="22" width="15" height="15" rx="4" fill="#3e9bf0" />
    </svg>
  ) },
  { id: 'beat', label: 'Build a beat', picture: (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      {[0, 1, 2].flatMap(row => [0, 1, 2, 3].map(column => {
        const filled = (row + column * 2) % 3 === 0;
        return <circle key={`${row}-${column}`} cx={5.5 + column * 9.7} cy={9 + row * 11} r="3.6" fill={filled ? '#f76b15' : 'none'} stroke={filled ? 'none' : '#8f97d8'} strokeWidth="1.6" />;
      }))}
    </svg>
  ) },
];

// Kids mode: big pads that sound when touched, a grid of pictures for building a beat, a few
// sounds chosen by picture, and one play button that loops both. There is nothing here to read,
// type or open, and nothing that reaches the projects, the account or any other site.
export default function KidsPage() {
  const [state, setState] = useState(loadKids);
  const [playing, setPlaying] = useState(false);
  const synth = useSynthAudio(), drums = useDrumAudio();
  const stateRef = useRef(state);
  stateRef.current = state;
  const rootRef = useRef<HTMLElement>(null);
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

  // The lights follow the loop without rendering: the scheduler writes the step to `playhead`
  // and this switches classes on the elements. They are put back after every render, because
  // a render may have replaced the elements or changed what a step holds.
  useLayoutEffect(() => {
    const mark = () => {
      const root = rootRef.current;
      if (!root) return;
      const step = playing ? playhead.get('kids') : -1;
      root.querySelectorAll<HTMLElement>('[data-step]').forEach(dot => dot.classList.toggle('now', Number(dot.dataset.step) === step));
      root.querySelectorAll<HTMLElement>('[data-beat]').forEach(cell => cell.classList.toggle('now', step >= 0 && Number(cell.dataset.beat) === step % KIDS_BEAT_STEPS));
      root.querySelectorAll<HTMLElement>('[data-pad]').forEach(pad => pad.classList.toggle('lit', step >= 0 && padSounds(stateRef.current, Number(pad.dataset.pad), step)));
    };
    mark();
    return playhead.subscribe('kids', mark);
  });

  const sound = (pad: number, time?: number, length = 0.35) => {
    const entry = KIDS_PADS[pad];
    if ('drum' in entry) void drums.playDrumHit(entry.drum, kidsDrumSettings(entry.drum), 1, time);
    else void synth.playNote(entry.note, KIDS_SOUNDS[stateRef.current.sound].params, length, 0.9, false, undefined, KIDS_TEMPOS[stateRef.current.tempo], 1, time);
  };

  const tickRef = useRef<(tick: TransportTick) => void>(() => {});
  tickRef.current = (tick) => {
    // The transport ticks in 32nd notes; a step here is an eighth.
    if (tick.step % 4 !== 0) return;
    const count = (tick.bar * 32 + tick.step) / 4, duration = tick.duration * 4;
    lastStep.current = { count, time: tick.time, duration };
    KIDS_PADS.forEach((_, pad) => {
      if (padSounds(stateRef.current, pad, count) && tapped.current.get(pad) !== count) sound(pad, tick.time, duration * 0.9);
    });
    playhead.set('kids', count % KIDS_STEPS);
  };

  const togglePlay = async () => {
    if (playing) {
      transportRef.current?.stop();
      synth.stopAllNotes();
      drums.stopAllNotes();
      lastStep.current = null;
      tapped.current.clear();
      playhead.set('kids', 0);
      setPlaying(false);
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

  // A hole in the grid is filled or emptied by a touch, and is heard as it is filled.
  const toggleBeat = (row: number, step: number) => {
    if (!stateRef.current.beat[row][step]) sound(KIDS_BEAT_ROWS[row]);
    setState(current => withBeatToggled(current, row, step));
  };

  const chooseSound = (index: number) => {
    setState(current => ({ ...current, sound: index }));
    void synth.playNote('G4', KIDS_SOUNDS[index].params, 0.35, 0.9);
  };

  // The sponge wipes what is on the screen it is pressed on, and leaves the other alone.
  const startAgain = () => {
    tapped.current.clear();
    setState(current => (current.screen === 'beat' ? { ...current, beat: blankKids().beat } : { ...current, notes: blankKids().notes }));
  };

  return (
    <main ref={rootRef} className="kids" aria-label="Kids mode" onContextMenu={(event) => event.preventDefault()}>
      <div className="kids-top">
        <div className="kids-screens" role="group" aria-label="Activity">
          {SCREENS.map(entry => (
            <button key={entry.id} className={`kids-screen ${entry.id === state.screen ? 'on' : ''}`} aria-label={entry.label} aria-pressed={entry.id === state.screen} onClick={() => setState(current => ({ ...current, screen: entry.id }))}>
              {entry.picture}
            </button>
          ))}
        </div>
        {state.screen === 'pads' && (
          <div className="kids-sounds" role="group" aria-label="Sound">
            {KIDS_SOUNDS.map((entry, index) => (
              <button key={entry.label} className={`kids-round ${index === state.sound ? 'on' : ''}`} aria-label={entry.label} aria-pressed={index === state.sound} {...press(() => chooseSound(index))}>
                {entry.picture}
              </button>
            ))}
          </div>
        )}
        <LeaveButton />
      </div>

      {state.screen === 'pads' ? (
        <>
          <div className="kids-pads" role="group" aria-label="Pads">
            {KIDS_PAD_ORDER.map(index => (
              <button key={index} className="kids-pad" data-pad={index} style={{ background: KIDS_PADS[index].color }} aria-label={KIDS_PADS[index].label} {...press(() => tap(index))}>
                {KIDS_PADS[index].picture}
              </button>
            ))}
          </div>
          <div className="kids-dots" aria-hidden="true">
            {Array.from({ length: KIDS_STEPS }, (_, step) => (
              <span key={step} data-step={step} className={state.notes.some(row => row[step]) ? 'on' : ''} />
            ))}
          </div>
        </>
      ) : (
        <div className="kids-grid" role="group" aria-label="Beat">
          {KIDS_BEAT_ROWS.flatMap((pad, row) => {
            const { label, picture, color } = KIDS_PADS[pad], tint = { '--pad': color } as CSSProperties;
            return [
              <button key={label} className="kids-row" data-pad={pad} style={tint} aria-label={label} {...press(() => sound(pad))}>{picture}</button>,
              ...state.beat[row].map((on, step) => (
                <button
                  key={`${label} ${step}`}
                  className={`kids-cell ${on ? 'on' : ''} ${step % 2 === 0 ? 'beat' : ''}`}
                  data-beat={step} style={tint}
                  aria-label={`${label} ${step + 1}`} aria-pressed={on}
                  {...press(() => toggleBeat(row, step))}
                >
                  {on ? picture : null}
                </button>
              )),
            ];
          })}
        </div>
      )}

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
        <button className="kids-round" aria-label="Start again" onClick={startAgain}>
          🧽
        </button>
      </div>
    </main>
  );
}
