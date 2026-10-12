import type { Studio } from '../studio/useStudio';
import { STARTERS } from '../services/starters';

// Shown only on a project with nothing in it: a few beats to start from and change, so the
// first thing a newcomer meets is not a rack of dark squares.
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
        <span className="rack-hint starter-hint">This project is empty. Pick a beat and a bass line to change, then press Play. Undo takes it back.</span>
        <div className="rack-grow" />
        <button className="rack-btn" title="Hide this and start from nothing" onClick={studio.dismissStarters}>Leave It Empty</button>
      </div>
    </section>
  );
}
