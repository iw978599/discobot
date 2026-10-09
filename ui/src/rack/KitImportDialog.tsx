import { useState } from 'react';
import type { DrumInstrument } from '../types';
import { MAX_KIT_FILES, matchKit } from '../services/kitImport';
import { saveSample } from '../services/sampleStore';
import Dialog from './Dialog';

interface KitImportDialogProps {
  // The audio files that were picked, already cut down to MAX_KIT_FILES.
  files: File[];
  // How many audio files were picked in all.
  picked: number;
  lanes: Array<{ id: DrumInstrument; label: string }>;
  onApply: (lane: DrumInstrument, sampleId: string) => Promise<void>;
  onClose: () => void;
}

// Several sample files at once: each drum lane is offered the file its name suggests, and
// nothing is stored or changed until the choices are confirmed.
export default function KitImportDialog({ files, picked, lanes, onApply, onClose }: KitImportDialogProps) {
  const [choice, setChoice] = useState(() => matchKit(files.map(file => file.name)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = lanes.filter(lane => choice[lane.id] !== undefined);

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      // A file put on two lanes is stored once.
      const stored = new Map<number, string>();
      for (const lane of chosen) {
        const index = choice[lane.id]!;
        if (!stored.has(index)) stored.set(index, (await saveSample(files[index])).id);
        await onApply(lane.id, stored.get(index)!);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The kit could not be imported.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Import a drum kit" closeLabel="Close kit import" onClose={busy ? () => {} : onClose}>
      <p>
        Each lane will play the file chosen for it here. The files were matched to lanes by their names, so check them and change any that are wrong.
        A lane set to “Leave as it is” keeps the sound it has.
      </p>
      {lanes.map(lane => (
        <div key={lane.id} className="rack-list-row" role="group" aria-label={`${lane.label} lane`}>
          <span><strong>{lane.label}</strong></span>
          <select
            aria-label={`File for ${lane.label}`}
            value={choice[lane.id] ?? ''}
            disabled={busy}
            onChange={(event) => {
              const { [lane.id]: _removed, ...rest } = choice;
              setChoice(event.target.value === '' ? rest : { ...rest, [lane.id]: Number(event.target.value) });
            }}
          >
            <option value="">Leave as it is</option>
            {files.map((file, index) => <option key={index} value={index}>{file.name}</option>)}
          </select>
        </div>
      ))}
      {picked > files.length && <p role="status">Only the first {MAX_KIT_FILES} of the {picked} audio files are listed.</p>}
      <p className="rack-empty">
        Only the files you put on a lane are kept. They stay in this browser: they are not uploaded, and are not part of project files, share links or your account.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="rack-dialog-actions">
        <button className="rack-btn go" disabled={busy || chosen.length === 0} onClick={() => { void apply(); }}>{busy ? 'Importing…' : 'Use These Sounds'}</button>
      </div>
    </Dialog>
  );
}
