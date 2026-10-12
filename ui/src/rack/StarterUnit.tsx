import type { Studio } from '../studio/useStudio';
import { STARTERS } from '../services/starters';

// Shown on a project that was opened with nothing in it: a few beats to start from and change,
// so the first thing a newcomer meets is not a rack of dark squares. Each can be tried in turn.
// It stays until Hide is pressed, so that nothing a person does in the rack below moves the rack.
export default function StarterUnit({ studio }: { studio: Studio }) {
  if (!studio.showStarters) return null;
  return (
    <section className="rack-unit starter-unit" aria-label="Starting points">
      <div className="rack-row">
        <div className="rack-plate static">
          <b>Start With</b>
        </div>
        <div className="starter-choices" role="group" aria-label="A beat to start from">
          {STARTERS.map(starter => (
            <button key={starter.id} className="rack-btn" title={starter.hint} onClick={() => studio.handleStarter(starter.id)}>{starter.name}</button>
          ))}
        </div>
        <span className="rack-hint starter-hint">Pick a beat and press Play. Each one replaces the drums and Synth 1's notes, and Undo takes it back.</span>
        <div className="rack-grow" />
        <button className="rack-btn" title="Hide these starting points" onClick={studio.dismissStarters}>Hide</button>
      </div>
    </section>
  );
}
