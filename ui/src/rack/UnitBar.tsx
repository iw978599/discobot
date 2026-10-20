import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { laneUnit, type RackUnit } from '../services/rackView';
import { playhead } from '../services/playhead';
import { drumsMuted, drumsSound, laneSounds, type ActivityLane } from '../services/unitActivity';
import { TAP_HOLD_MS, TAP_SLOP } from '../components/useKnobInteraction';
import type { DrumState } from '../types';
import { laneName, shownLanes } from '../services/lanes';

interface UnitBarProps {
  shown: RackUnit;
  // The synth lanes that have been added; the other slots are still offered, to add one.
  synths: ActivityLane[];
  drums: DrumState;
  playing: boolean;
  guests: boolean;
  onShow: (unit: RackUnit) => void;
  onMuteLane: (id: number, muted: boolean) => void;
  onMuteDrums: (muted: boolean) => void;
}

interface Tab {
  id: RackUnit;
  label: string;
  name: string;
  empty?: boolean;
  // For a unit that makes sound of its own: what its lamp follows, whether it is muted, and how to mute it.
  lamp?: string;
  muted?: boolean;
  mute?: () => void;
}

// The bar along the bottom of a narrow screen: one switch for each unit of the rack. A tap shows
// the unit, and the one on show has a lit line along its top. A lane's lamp, and the drums',
// lights on each step that unit sounds, so the whole rack's playing can be seen from any unit;
// holding a switch mutes its unit without going to it. The units themselves are the same ones
// a wide screen stacks.
export default function UnitBar({ shown, synths, drums, playing, guests, onShow, onMuteLane, onMuteDrums }: UnitBarProps) {
  const barRef = useRef<HTMLElement>(null);
  const allDrumsMuted = drumsMuted(drums);
  const units: Tab[] = [
    { id: 'song', label: 'Song', name: 'Show Song' },
    ...shownLanes(synths.map(synth => synth.id)).map((id): Tab => {
      const lane = synths.find(synth => synth.id === id);
      if (!lane) return { id: laneUnit(id), label: `Synth ${id}`, empty: true, name: `Show Synth ${id}, an empty slot` };
      return {
        id: laneUnit(id), label: laneName(id, lane.name), name: `Show ${laneName(id, lane.name)}`, lamp: String(id), muted: Boolean(lane.muted),
        mute: () => onMuteLane(id, !lane.muted),
      };
    }),
    ...(guests ? [{ id: 'guests' as const, label: 'Guests', name: 'Show Guests' }] : []),
    { id: 'drums', label: 'Drums', name: 'Show Drums', lamp: 'drums', muted: allDrumsMuted, mute: () => onMuteDrums(!allDrumsMuted) },
    { id: 'mixer', label: 'Mixer', name: 'Show Mixer' },
    { id: 'effects', label: 'Effects', name: 'Show Effects' },
    { id: 'all', label: 'All', name: 'Show all units on one page' },
  ];

  // The lamps follow the playhead the way the step lights do: the class is switched on the
  // elements themselves and nothing renders. It is put back after every render, with no
  // dependency list on purpose, so `lit` must not appear in a lamp's className.
  useLayoutEffect(() => {
    const mark = () => {
      barRef.current?.querySelectorAll<HTMLElement>('.unit-tab-led[data-lamp]').forEach((lamp) => {
        const lane = lamp.dataset.lamp;
        const sounding = lane === 'drums'
          ? playing && drumsSound(drums, playhead.get('drums'))
          : laneSounds(synths, Number(lane), playhead.get(Number(lane)));
        lamp.classList.toggle('lit', sounding);
      });
    };
    mark();
    const stops = [playhead.subscribe('drums', mark), ...synths.map(synth => playhead.subscribe(synth.id, mark))];
    return () => stops.forEach(stop => stop());
  });

  // A switch that is held mutes its unit. The press that did it must not also show the unit:
  // a mouse sends a click when it lets go, and a finger that held does not.
  const hold = useRef<{ timer: number; x: number; y: number; fire: () => void } | null>(null);
  const held = useRef(false);
  const letGo = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => letGo, []);
  const press = (event: PointerEvent, unit: Tab) => {
    held.current = false;
    letGo();
    if (!unit.mute || event.button !== 0) return;
    const mute = unit.mute;
    const fire = () => { letGo(); held.current = true; mute(); };
    hold.current = { x: event.clientX, y: event.clientY, fire, timer: window.setTimeout(fire, TAP_HOLD_MS) };
  };
  // A phone answers a held finger with its own menu, and may do so before the time above is up.
  // There is no menu to show here, and that hold is the same hold.
  const menu = (event: MouseEvent) => {
    event.preventDefault();
    hold.current?.fire();
  };
  const move = (event: PointerEvent) => {
    if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > TAP_SLOP) letGo();
  };
  const click = (unit: Tab) => {
    if (held.current) { held.current = false; return; }
    onShow(unit.id);
  };
  // The same from the keyboard. A letter alone is a note on the computer-keyboard piano.
  const key = (event: KeyboardEvent, unit: Tab) => {
    if (!unit.mute || event.code !== 'KeyM' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    unit.mute();
  };

  return (
    <nav ref={barRef} className="unit-bar" aria-label="Rack units">
      {units.map(unit => (
        <button
          key={unit.id}
          className={`unit-tab ${unit.empty ? 'empty' : ''}`}
          aria-label={unit.name}
          data-tab={unit.id}
          aria-current={unit.id === shown ? 'true' : undefined}
          aria-keyshortcuts={unit.mute ? 'Shift+M' : undefined}
          data-muted={unit.muted ? 'true' : undefined}
          title={unit.mute ? (unit.muted ? 'Muted. Hold, or press Shift+M, to unmute' : 'Hold, or press Shift+M, to mute') : undefined}
          onClick={() => click(unit)}
          onPointerDown={(event) => press(event, unit)}
          onPointerMove={move}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onPointerLeave={letGo}
          onContextMenu={unit.mute ? menu : undefined}
          onKeyDown={(event) => key(event, unit)}
        >
          <span className="unit-tab-led" data-lamp={unit.lamp} />
          <span className="unit-tab-name">{unit.label}</span>
        </button>
      ))}
    </nav>
  );
}
