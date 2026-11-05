import { memo, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { DrumRow, DrumState, DrumTrack, TimeSignature } from '../types';
import type { SynthState } from '../studio/studioState';
import { guestOrigin, type Guest } from '../services/guests';
import { getSynthModelDefinition } from '../synthModels';
import { drumsMuted } from '../services/unitActivity';
import { laneName, laneSound, nextExtraLane, shownLanes, MAX_LANES } from '../services/lanes';
import { laneTrack, storeDrumsOpen, storedDrumsOpen, type DeskTrack } from '../services/deskFrame';
import { DRUM_ROW_NAMES, shownDrumRows } from '../services/drumKits';
import { barSteps, laneBars, stepsPerBar } from '../services/patternLength';
import { drumLine, overviewColumns, toggledNotes } from '../services/deskOverview';
import { stepNotes } from '../services/noteScheduling';
import { drumSelection } from '../services/drumSelection';
import DeskCells, { type DeskCellData } from './DeskCells';
import { DeskViewSwitch } from './DeskSong';
import type { DeskView } from '../services/deskSong';

// What the overview does with a cell or a header, handed down once and kept the same across renders.
interface Actions {
  show: (track: DeskTrack) => void;
  muteLane: (id: number, muted: boolean) => void;
  soloLane: (id: number, solo: boolean) => void;
  muteDrums: (muted: boolean) => void;
  assignNotes: (id: number, step: number, notes: string[], on: boolean) => void;
  selectStep: (id: number, step: number) => void;
  toggleDrum: (row: DrumRow, step: number, active: boolean) => void;
  setDrumsOpen: (open: boolean) => void;
}

interface DeskTrackListProps {
  synths: SynthState[];
  laneOrder?: number[];
  drums: DrumState;
  guests: Guest[];
  track: DeskTrack;
  // The open scene's length in bars and its time signature: the overview's width and its beats.
  bars: number;
  signature: TimeSignature | undefined;
  // Whether any music plays, which lights the drums' steps.
  playing: boolean;
  onShow: (track: DeskTrack) => void;
  onMuteLane: (id: number, muted: boolean) => void;
  onSoloLane: (id: number, solo: boolean) => void;
  onMuteDrums: (muted: boolean) => void;
  onAddLane: (id: number) => void;
  // A click on a lane's cell: notes put on a step or taken off it (which also selects it).
  onAssignNotes: (id: number, step: number, notes: string[], on: boolean) => void;
  onSelectStep: (id: number, step: number) => void;
  onToggleDrum: (row: DrumRow, step: number, active: boolean) => void;
  // Which of the two views the tracks region shows, and the Song view itself, which Rack makes.
  view: DeskView;
  onView: (view: DeskView) => void;
  songView: ReactNode;
}

type Rows = Record<DrumRow, DrumTrack>;

// A lane's row: its header (colour, name, sound, mute, solo) and its cells. Rendered again only when its
// own lane changes, not for another lane's edit.
const LaneTrack = memo(function LaneTrack({ synth, here, bars, signature, actions }: { synth: SynthState; here: boolean; bars: number; signature: TimeSignature | undefined; actions: Actions }) {
  const id = synth.id, pattern = synth.pattern;
  const name = laneName(id, synth.name);
  const stepCount = pattern?.steps.length ?? 0;
  const perBar = pattern ? stepsPerBar(stepCount, pattern.bars, signature) : barSteps(signature);
  const length = Math.max(bars, pattern ? laneBars(stepCount, pattern.bars, signature) : 1);
  const selectedStep = synth.selectedStep;
  const cells = useMemo<DeskCellData[]>(() => overviewColumns(stepCount, perBar, length, signature).map((cell) => {
    const step = pattern!.steps[cell.step];
    const notes = stepNotes(step);
    return {
      ...cell,
      on: notes.length > 0,
      strength: step?.velocity ?? 0.7,
      dashed: notes.length > 0 && (step?.probability ?? 1) < 1,
      selected: selectedStep === cell.step && !cell.ghost,
      title: notes.length > 0 ? `${notes.join(' ')} (Shift+click to select it without removing it)` : 'Shift+click to select without adding a note',
    };
  }), [pattern, stepCount, perBar, length, signature, selectedStep]);
  return (
    <li className="desk-track" data-track={laneTrack(id)} style={{ '--track-color': `var(--track-${id})` } as CSSProperties}>
      <div className="desk-track-head">
        <button className="desk-track-pick" aria-current={here ? 'true' : undefined} aria-label={`Show ${name} in the dock`} onClick={() => actions.show(laneTrack(id))}>
          <span className="desk-track-swatch" aria-hidden="true" />
          <span className="desk-track-name">{name}</span>
          <span className="desk-track-sound">{laneSound(synth.synthModelId, getSynthModelDefinition(synth.synthModelId).name, synth.preset)}</span>
        </button>
        <span className="desk-track-ms">
          <button className={synth.muted ? 'on' : ''} aria-pressed={synth.muted} aria-label={`Track list mute ${name}`} onClick={() => actions.muteLane(id, !synth.muted)}>M</button>
          <button className={synth.solo ? 'on' : ''} aria-pressed={synth.solo} aria-label={`Track list solo ${name}`} onClick={() => actions.soloLane(id, !synth.solo)}>S</button>
        </span>
      </div>
      {pattern ? (
        <DeskCells
          name={name}
          cells={cells}
          stepCount={stepCount}
          lane={id}
          playing={synth.isPlaying}
          onCell={(cell, shift) => {
            actions.show(laneTrack(id));
            if (shift) { actions.selectStep(id, cell.step); return; }
            const change = toggledNotes(pattern.steps[cell.step], synth.octaveShift);
            actions.assignNotes(id, cell.step, change.notes, change.on);
          }}
        />
      ) : <div className="desk-cells desk-cells-empty" aria-hidden="true" />}
    </li>
  );
});

// One drum of the open fold: its name in its colour and its cells.
const DrumRowTrack = memo(function DrumRowTrack({ row, data, bars, signature, picked, playing, actions }: { row: DrumRow; data: DrumTrack; bars: number; signature: TimeSignature | undefined; picked: number | null; playing: boolean; actions: Actions }) {
  const name = DRUM_ROW_NAMES[row];
  const perBar = barSteps(signature);
  const stepCount = data.steps.length;
  const cells = useMemo<DeskCellData[]>(() => overviewColumns(stepCount, perBar, Math.max(bars, stepCount / perBar), signature).map((cell) => {
    const on = Boolean(data.steps[cell.step]);
    const repeats = data.stepRatchets?.[cell.step] ?? 1;
    return {
      ...cell,
      on,
      strength: data.stepVelocities?.[cell.step] ?? 1,
      dashed: on && (data.stepProbabilities?.[cell.step] ?? 1) < 1,
      selected: picked === cell.step && !cell.ghost,
      text: on && repeats > 1 ? `×${repeats}` : undefined,
      title: on ? `${name} (Shift+click to select it without removing it)` : 'Shift+click to select without adding a hit',
    };
  }), [data, stepCount, perBar, bars, signature, picked, name]);
  return (
    <li className="desk-track desk-drum-row" data-drum={row}>
      <div className="desk-track-head">
        <button className="desk-track-pick" aria-label={`Show ${name} in the dock`} onClick={() => { actions.show('drums'); drumSelection.pick(row, picked ?? 0); }}>
          <span className="desk-track-swatch" aria-hidden="true" />
          <span className="desk-track-name">{name}</span>
        </button>
      </div>
      <DeskCells
        name={name}
        cells={cells}
        stepCount={stepCount}
        lane="drums"
        playing={playing}
        onCell={(cell, shift) => {
          actions.show('drums');
          drumSelection.pick(row, cell.step);
          if (!shift) actions.toggleDrum(row, cell.step, !data.steps[cell.step]);
        }}
      />
    </li>
  );
});

function DrumsTrack({ drums, here, open, bars, signature, playing, actions }: { drums: DrumState; here: boolean; open: boolean; bars: number; signature: TimeSignature | undefined; playing: boolean; actions: Actions }) {
  const allMuted = drumsMuted(drums);
  const chosen = useSyncExternalStore(drumSelection.subscribe, drumSelection.get);
  const rows = shownDrumRows(drums);
  const perBar = barSteps(signature);
  const length = drums.kick?.steps.length ?? perBar;
  const combined = useMemo<DeskCellData[]>(() => {
    const line = drumLine(shownDrumRows(drums).map(row => (drums as unknown as Rows)[row]), length);
    return overviewColumns(length, perBar, Math.max(bars, length / perBar), signature).map(cell => ({
      ...cell, on: line[cell.step].on, strength: line[cell.step].velocity, dashed: false, selected: false,
      title: 'Press to open the drums into their rows',
    }));
  }, [drums, length, perBar, bars, signature]);
  return (
    <li className="desk-track desk-drums" data-track="drums" data-open={open ? 'true' : undefined} style={{ '--track-color': 'var(--drum-kick)' } as CSSProperties}>
      <div className="desk-track-head">
        <button className="desk-track-pick" aria-current={here ? 'true' : undefined} aria-label="Show Drums in the dock" onClick={() => actions.show('drums')}>
          <span className="desk-track-swatch" aria-hidden="true" />
          <span className="desk-track-name">Drums</span>
          <span className="desk-track-sound">Drum machine</span>
        </button>
        <span className="desk-track-ms">
          <button className="desk-fold" aria-expanded={open} aria-label="Drum rows" title={open ? 'Fold the drums into one line' : 'Open the drums into their rows'} onClick={() => actions.setDrumsOpen(!open)}>{open ? '▾' : '▸'}</button>
          <button className={allMuted ? 'on' : ''} aria-pressed={allMuted} aria-label="Track list mute Drums" onClick={() => actions.muteDrums(!allMuted)}>M</button>
        </span>
      </div>
      {open
        ? <div className="desk-cells desk-cells-empty" aria-hidden="true" />
        : <DeskCells name="Drums" cells={combined} stepCount={length} lane="drums" playing={playing} pressable={false} onCell={() => actions.setDrumsOpen(true)} />}
      {open && (
        <ul className="desk-drum-rows" aria-label="Drum rows">
          {rows.map(row => (
            <DrumRowTrack
              key={row}
              row={row}
              data={(drums as unknown as Rows)[row]}
              bars={bars}
              signature={signature}
              picked={chosen.row === row ? chosen.step : null}
              playing={playing}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// The desk's tracks (docs/DESK_LAYOUT_PLAN.md, stages 2 and 3): one row for each track, in the order the
// rack shows them. A row is its header, which is stage 2's track list, and beside it that track's
// pattern for the open scene, under a bar ruler. Both scroll together, so a header and its cells always
// line up. Pressing a header picks the track for the dock, and a lane is also made the studio's open
// lane, so the keyboard and MIDI follow. Mute and solo call the same handlers as the lane's own plate.
// A click on a cell edits the step, a Shift+click only selects it. Whether the drums are folded open is
// this browser's (services/deskFrame.ts); the list holds no other state.
export default function DeskTrackList(props: DeskTrackListProps) {
  const { synths, laneOrder, drums, guests, track, bars, signature, playing, onAddLane, view, onView, songView } = props;
  const latest = useRef(props);
  latest.current = props;
  const [drumsOpen, setDrumsOpenState] = useState(storedDrumsOpen);
  const actions = useMemo<Actions>(() => ({
    show: next => latest.current.onShow(next),
    muteLane: (id, muted) => latest.current.onMuteLane(id, muted),
    soloLane: (id, solo) => latest.current.onSoloLane(id, solo),
    muteDrums: muted => latest.current.onMuteDrums(muted),
    assignNotes: (id, step, notes, on) => latest.current.onAssignNotes(id, step, notes, on),
    selectStep: (id, step) => latest.current.onSelectStep(id, step),
    toggleDrum: (row, step, active) => latest.current.onToggleDrum(row, step, active),
    setDrumsOpen: (open) => { setDrumsOpenState(open); storeDrumsOpen(open); },
  }), []);
  const ids = synths.map(synth => synth.id);
  const next = nextExtraLane(ids);
  if (view === 'song') return <nav className="desk-tracks" aria-label="Tracks" data-view="song">{songView}</nav>;
  return (
    <nav className="desk-tracks" aria-label="Tracks" data-view="patterns">
      <div className="desk-grid" style={{ '--cols': bars * barSteps(signature) } as CSSProperties}>
        <div className="desk-ruler">
          <DeskViewSwitch view={view} onView={onView} />
          <span className="desk-ruler-bars" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))` }}>
            {Array.from({ length: bars }, (_, bar) => <span key={bar} className="desk-ruler-bar">{bar + 1}</span>)}
          </span>
        </div>
        <ul>
          {shownLanes(ids, laneOrder).map((id) => {
            const synth = synths.find(entry => entry.id === id);
            return synth ? <LaneTrack key={id} synth={synth} here={track === laneTrack(id)} bars={bars} signature={signature} actions={actions} /> : null;
          })}
          <DrumsTrack drums={drums} here={track === 'drums'} open={drumsOpen} bars={bars} signature={signature} playing={playing} actions={actions} />
          {guests.map((guest, index) => {
            const name = guest.name || guestOrigin(guest.url) || `Guest ${index + 1}`;
            return (
              <li key={guest.id} className="desk-track" data-track="guests" style={{ '--track-color': 'var(--track-guest)' } as CSSProperties}>
                <div className="desk-track-head">
                  <button className="desk-track-pick" aria-current={track === 'guests' ? 'true' : undefined} aria-label={`Show guest ${name} in the dock`} onClick={() => actions.show('guests')}>
                    <span className="desk-track-swatch" aria-hidden="true" />
                    <span className="desk-track-name">{name}</span>
                    <span className="desk-track-sound">Guest instrument</span>
                  </button>
                </div>
                <div className="desk-cells desk-cells-empty desk-guest-note" aria-hidden="true">Guest instrument: no steps here, its page is in the dock</div>
              </li>
            );
          })}
        </ul>
        {next !== null && (
          <button className="rack-btn desk-add-lane" aria-label={`Add Synth ${next} from the track list`} title={`A project can have up to ${MAX_LANES} synth lanes. This adds Synth ${next}, on MIDI channel ${next}.`} onClick={() => onAddLane(next)}>
            Add Lane +
          </button>
        )}
      </div>
    </nav>
  );
}
