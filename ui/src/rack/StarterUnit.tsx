import type { Studio } from '../studio/useStudio';
import { STARTERS } from '../services/starters';
import { SAMPLE_SONGS } from '../services/sampleSongs';

// Shown on a project that was opened with nothing in it, which is where a first visit starts: one
// plain question, put as three answers. Hear a finished song (each opens as a new project of its
// own, to play and take apart), start from a beat (which replaces the drums and Synth 1's notes,
// and can be tried in turn), or start empty. It stays until Start empty is pressed, so that
// nothing a person does in the rack below moves the rack.
export default function StarterUnit({ studio }: { studio: Studio }) {
  if (!studio.showStarters) return null;
  return (
    <section className="rack-unit starter-unit" aria-label="Starting points">
      <div className="rack-row">
        <div className="rack-plate static">
          <b>Start With</b>
        </div>
        <div className="starter-options">
          <div className="starter-choices" role="group" aria-label="A song to hear">
            <span className="starter-label">Hear a song</span>
            {SAMPLE_SONGS.map(song => (
              <button key={song.id} className="rack-btn starter-song" aria-label={song.name} title={song.hint} onClick={() => { void studio.handleSampleSong(song.id); }}>
                {song.name}<small aria-hidden="true">{song.genre}</small>
              </button>
            ))}
          </div>
          <div className="starter-choices" role="group" aria-label="A beat to start from">
            <span className="starter-label">Start from a beat</span>
            {STARTERS.map(starter => (
              <button key={starter.id} className="rack-btn" title={starter.hint} onClick={() => studio.handleStarter(starter.id)}>{starter.name}</button>
            ))}
          </div>
          <span className="rack-hint starter-hint">A song opens as a new project of its own, ready to play as a song. A beat replaces the drums and Synth 1's notes, and Undo takes it back.</span>
        </div>
        <div className="rack-grow" />
        <button className="rack-btn" title="Put these away and start with the empty project" onClick={studio.dismissStarters}>Start empty</button>
      </div>
    </section>
  );
}
