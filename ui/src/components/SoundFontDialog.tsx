import { useState } from 'react';
import Dialog from '../rack/Dialog';
import type { SoundFontFile, SoundFontPreset } from '../services/soundFont';

interface SoundFontDialogProps {
  font: SoundFontFile;
  onImport: (preset: SoundFontPreset) => void;
  onClose: () => void;
  // For the drum lanes: the title, the words, and which instrument to start on (a kit).
  title?: string;
  noun?: string;
  prefer?: (preset: SoundFontPreset) => boolean;
}

// Which instrument of a SoundFont to import, when it has more than one. Each is named as the font
// names it, with its bank and program, which is how a General MIDI set numbers them.
export default function SoundFontDialog({ font, onImport, onClose, title = 'Import a SoundFont instrument', noun = 'this lane', prefer }: SoundFontDialogProps) {
  const [chosen, setChosen] = useState((prefer && font.presets.find(prefer))?.index ?? font.presets[0]?.index ?? 0);
  const preset = font.presets.find(entry => entry.index === chosen);
  return (
    <Dialog title={title} closeLabel="Close" onClose={onClose} initialFocus="select" small>
      <p>{font.name || 'This SoundFont'} has {font.presets.length} instruments. Choose one for {noun}.</p>
      <label className="soundfont-choice">
        Instrument
        <select aria-label="SoundFont instrument" value={chosen} onChange={event => setChosen(Number(event.target.value))}>
          {font.presets.map(entry => <option key={entry.index} value={entry.index}>{`${entry.bank}:${entry.program} ${entry.name}`}</option>)}
        </select>
      </label>
      <div className="rack-dialog-actions">
        <button className="rack-btn" onClick={onClose}>Cancel</button>
        <button className="rack-btn go" disabled={!preset} onClick={() => preset && onImport(preset)}>Import</button>
      </div>
    </Dialog>
  );
}
