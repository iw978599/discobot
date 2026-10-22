import { useSyncExternalStore } from 'react';
import Dialog from './Dialog';
import { SCHEMES, colourScheme, resolveScheme, type SchemeChoice } from '../services/colourScheme';

// Chooses this browser's colour scheme. A choice is shown at once and kept; it is not part of
// any project. Each choice carries a small sample of its own colours, drawn by the stylesheet
// from the scheme it names (`data-sample`).
export default function ColourSchemeDialog({ onClose }: { onClose: () => void }) {
  const chosen = useSyncExternalStore(colourScheme.subscribe, colourScheme.get);
  const sample = (choice: SchemeChoice) => resolveScheme(choice, typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches);
  return (
    <Dialog title="Colour Scheme" closeLabel="Close colour scheme" onClose={onClose} initialFocus="input:checked">
      <fieldset className="scheme-choices">
        <legend>Colours for the rack in this browser</legend>
        {SCHEMES.map(scheme => (
          <label key={scheme.id} className="scheme-choice">
            <input type="radio" name="colour-scheme" value={scheme.id} checked={chosen === scheme.id} onChange={() => colourScheme.set(scheme.id)} />
            <span className="scheme-sample" data-sample={sample(scheme.id)} aria-hidden="true"><i /><i /><i /></span>
            <span className="scheme-words"><strong>{scheme.name}</strong><span>{scheme.about}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="rack-hint">Kept in this browser for every project. Kids mode keeps its own colours.</p>
    </Dialog>
  );
}
