import type { Studio } from '../studio/useStudio';
import { MAX_LANES, nextExtraLane } from '../services/lanes';

// After the standing three lanes, a place to add the next one, while there are fewer than the most a
// project can have. On a narrow screen it is shown with Synth 3, which it follows on the rack (by a rule in the phone block of rack.css).
export default function AddLaneUnit({ studio }: { studio: Studio }) {
  const next = nextExtraLane(studio.synths.map(synth => synth.id));
  if (next === null) return null;
  return (
    <section className="rack-unit empty add-lane" aria-label="Add a lane" data-unit="add-lane">
      <button
        className="rack-btn"
        onClick={() => { void studio.ensureSynthExists(next).then(created => { if (created) studio.setSelectedSynthId(next); }); }}
      >
        Add Lane +
      </button>
      <span className="rack-hint">A project can have up to {MAX_LANES} synth lanes. This adds Synth {next}, on MIDI channel {next}.</span>
    </section>
  );
}
