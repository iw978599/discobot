import type { Studio } from '../studio/useStudio';
import { STARTERS } from '../services/starters';
import { SAMPLE_SONGS } from '../services/sampleSongs';
import Menu from './Menu';

// Shown on a project that was opened with nothing in it, which is where a first visit starts: one
// plain question, put as three answers, the first two as menus. Hear a finished song (each opens as a new project of its
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
        {/* Two menus, not a button for each: the songs and the beats outgrew a row (2026-10-26). */}
        <div className="starter-options">
          <Menu label="Hear a song" name="A song to hear" groups={[SAMPLE_SONGS.map(song => ({ label: song.name, title: song.genre, onSelect: () => { void studio.handleSampleSong(song.id); } }))]} />
          <Menu label="Start from a beat" name="A beat to start from" groups={[STARTERS.map(starter => ({ label: starter.name, title: starter.hint, onSelect: () => studio.handleStarter(starter.id) }))]} />
          <span className="rack-hint starter-hint">A song opens as a new project of its own, ready to play as a song. A beat replaces the drums and Synth 1's notes, and Undo takes it back.</span>
        </div>
        <div className="rack-grow" />
        <button className="rack-btn" title="Put these away and start with the empty project" onClick={studio.dismissStarters}>Start empty</button>
      </div>
    </section>
  );
}
