import { laneUnit, type RackUnit } from '../services/rackView';

interface UnitBarProps {
  shown: RackUnit;
  // The synth lanes that have been added; the other slots are still offered, to add one.
  lanes: number[];
  guests: boolean;
  onShow: (unit: RackUnit) => void;
}

// The bar along the bottom of a narrow screen: one switch for each unit of the rack, and the
// lit one is on screen. It is navigation, not a second set of controls; the units themselves
// are the same ones a wide screen stacks.
export default function UnitBar({ shown, lanes, guests, onShow }: UnitBarProps) {
  const units: Array<{ id: RackUnit; label: string; name: string; empty?: boolean }> = [
    { id: 'song', label: 'Song', name: 'Show Song' },
    ...[1, 2, 3].map(id => ({
      id: laneUnit(id), label: `Synth ${id}`, empty: !lanes.includes(id),
      name: lanes.includes(id) ? `Show Synth ${id}` : `Show Synth ${id}, an empty slot`,
    })),
    ...(guests ? [{ id: 'guests' as const, label: 'Guests', name: 'Show Guests' }] : []),
    { id: 'drums', label: 'Drums', name: 'Show Drums' },
    { id: 'effects', label: 'Effects', name: 'Show Effects' },
    { id: 'all', label: 'All', name: 'Show all units on one page' },
  ];
  return (
    <nav className="unit-bar" aria-label="Rack units">
      {units.map(unit => (
        <button
          key={unit.id}
          className={`unit-tab ${unit.empty ? 'empty' : ''}`}
          aria-label={unit.name}
          aria-current={unit.id === shown ? 'true' : undefined}
          onClick={() => onShow(unit.id)}
        >
          <span className="unit-tab-led" />
          <span className="unit-tab-name">{unit.label}</span>
        </button>
      ))}
    </nav>
  );
}
