import type { CSSProperties } from 'react';
import type { DrumState } from '../types';
import type { SynthState } from '../studio/studioState';
import { guestOrigin, type Guest } from '../services/guests';
import { getSynthModelDefinition } from '../synthModels';
import { drumsMuted } from '../services/unitActivity';
import { laneName, laneSound, nextExtraLane, shownLanes, MAX_LANES } from '../services/lanes';
import { laneTrack, type DeskTrack } from '../services/deskFrame';


interface DeskTrackListProps {
  synths: SynthState[];
  laneOrder?: number[];
  drums: DrumState;
  guests: Guest[];
  track: DeskTrack;
  onShow: (track: DeskTrack) => void;
  onMuteLane: (id: number, muted: boolean) => void;
  onSoloLane: (id: number, solo: boolean) => void;
  onMuteDrums: (muted: boolean) => void;
  onAddLane: (id: number) => void;
}

// The desk's left column (docs/DESK_LAYOUT_PLAN.md, stage 2): one row for each track, in the order the
// rack shows them. A row's swatch is the track's colour; pressing the row picks the track for the
// dock, and a lane is also made the studio's open lane, so the keyboard and MIDI follow. Mute and solo
// call the same handlers as the lane's own plate. The list holds no state of its own.
export default function DeskTrackList({ synths, laneOrder, drums, guests, track, onShow, onMuteLane, onSoloLane, onMuteDrums, onAddLane }: DeskTrackListProps) {
  const ids = synths.map(synth => synth.id);
  const next = nextExtraLane(ids);
  const allDrumsMuted = drumsMuted(drums);
  return (
    <nav className="desk-tracks" aria-label="Tracks">
      <ul>
        {shownLanes(ids, laneOrder).map((id) => {
          const synth = synths.find(entry => entry.id === id);
          if (!synth) return null;
          const name = laneName(id, synth.name);
          const here = track === laneTrack(id);
          return (
            <li key={id} className="desk-track" data-track={laneTrack(id)} style={{ '--track-color': `var(--track-${id})` } as CSSProperties}>
              <button className="desk-track-pick" aria-current={here ? 'true' : undefined} aria-label={`Show ${name} in the dock`} onClick={() => onShow(laneTrack(id))}>
                <span className="desk-track-swatch" aria-hidden="true" />
                <span className="desk-track-name">{name}</span>
                <span className="desk-track-sound">{laneSound(synth.synthModelId, getSynthModelDefinition(synth.synthModelId).name, synth.preset)}</span>
              </button>
              <span className="desk-track-ms">
                <button className={synth.muted ? 'on' : ''} aria-pressed={synth.muted} aria-label={`Track list mute ${name}`} onClick={() => onMuteLane(id, !synth.muted)}>M</button>
                <button className={synth.solo ? 'on' : ''} aria-pressed={synth.solo} aria-label={`Track list solo ${name}`} onClick={() => onSoloLane(id, !synth.solo)}>S</button>
              </span>
            </li>
          );
        })}
        <li className="desk-track" data-track="drums" style={{ '--track-color': 'var(--drum-kick)' } as CSSProperties}>
          <button className="desk-track-pick" aria-current={track === 'drums' ? 'true' : undefined} aria-label="Show Drums in the dock" onClick={() => onShow('drums')}>
            <span className="desk-track-swatch" aria-hidden="true" />
            <span className="desk-track-name">Drums</span>
            <span className="desk-track-sound">Drum machine</span>
          </button>
          <span className="desk-track-ms">
            <button className={allDrumsMuted ? 'on' : ''} aria-pressed={allDrumsMuted} aria-label="Track list mute Drums" onClick={() => onMuteDrums(!allDrumsMuted)}>M</button>
          </span>
        </li>
        {guests.map((guest, index) => {
          const name = guest.name || guestOrigin(guest.url) || `Guest ${index + 1}`;
          return (
            <li key={guest.id} className="desk-track" data-track="guests" style={{ '--track-color': 'var(--track-guest)' } as CSSProperties}>
              <button className="desk-track-pick" aria-current={track === 'guests' ? 'true' : undefined} aria-label={`Show guest ${name} in the dock`} onClick={() => onShow('guests')}>
                <span className="desk-track-swatch" aria-hidden="true" />
                <span className="desk-track-name">{name}</span>
                <span className="desk-track-sound">Guest instrument</span>
              </button>
            </li>
          );
        })}
      </ul>
      {next !== null && (
        <button className="rack-btn desk-add-lane" aria-label={`Add Synth ${next} from the track list`} title={`A project can have up to ${MAX_LANES} synth lanes. This adds Synth ${next}, on MIDI channel ${next}.`} onClick={() => onAddLane(next)}>
          Add Lane +
        </button>
      )}
    </nav>
  );
}
