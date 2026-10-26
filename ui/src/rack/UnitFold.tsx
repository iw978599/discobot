import { useSyncExternalStore } from 'react';
import { foldedUnits, type RackUnit } from '../services/rackView';

// Whether a unit is folded down to its name plate. Its own store, not the studio's, so a tracked
// unit may read it while rendering.
export function useFolded(unit: RackUnit): boolean {
  return useSyncExternalStore(foldedUnits.subscribe, () => foldedUnits.get().has(unit), () => false);
}

// The fold in the corner of a unit's name plate, beside its "?": Hide puts the unit away down to
// its name, and Show brings it back. Laid over the plate's own room, as the "?" is.
export default function UnitFold({ unit, about }: { unit: RackUnit; about: string }) {
  const folded = useFolded(unit);
  return (
    <button
      type="button"
      className="rack-btn unit-fold"
      aria-expanded={!folded}
      aria-label={`${folded ? 'Show' : 'Hide'} ${about}`}
      title={folded ? `Show ${about} again` : `Hide ${about} down to its name, to see more of the rest`}
      onClick={() => foldedUnits.set(unit, !folded)}
    >
      <span aria-hidden="true">▾</span>
    </button>
  );
}
