// Which section of Help is about each unit of the rack.
export const UNIT_HELP = {
  song: 'help-scenes',
  synth: 'help-lanes',
  drums: 'help-drums',
  effects: 'help-effects',
  guests: 'help-guests',
} as const;

// The small "?" in the corner of a unit's name plate: opens Help at the section about that unit.
// It is laid over the plate's own room (rack.css), so the plate is no taller for it.
export default function UnitHelp({ about, section, onHelp }: { about: string; section: string; onHelp: (section: string) => void }) {
  return (
    <button type="button" className="rack-btn unit-help" aria-label={`Help for ${about}`} title={`Help for ${about}`} onClick={() => onHelp(section)}>?</button>
  );
}
