import { useState } from 'react';
import type { DrumInstrument, DrumRow } from '../types';
import Toggle from '../components/Toggle';
import { MAX_KIT_FILES, matchKit } from '../services/kitImport';
import { saveSample } from '../services/sampleStore';
import Dialog from './Dialog';

interface KitImportDialogProps {
  // The audio files that were picked, already cut down to MAX_KIT_FILES.
  files: File[];
  // How many audio files were picked in all.
  picked: number;
  lanes: Array<{ id: DrumInstrument; label: string }>;
  // The file each lane starts with, when something better than the names knows (a SoundFont kit).
  initial?: Partial<Record<DrumInstrument, number>>;
  onApply: (lane: DrumRow, sampleId: string) => Promise<void>;
  // How many rows can still be added after the eight, and adding one: its id, or null when none can.
  freeRows?: number;
  onAddRow?: () => DrumRow | null;
  // Where the files came from, when another app sent them ("Drum Foundry (example.com)").
  source?: string;
  // Told how many files were kept, before the dialog closes after its Import.
  onImported?: (count: number) => void;
  onClose: () => void;
}

// Several sample files at once: each drum lane is offered the file its name suggests, and
// nothing is stored or changed until the choices are confirmed.
// The files no drum is given can each have a row of their own, added after the eight
// (docs/DRUM_ROWS_PLAN.md): as many as there are rows left, the first of them to begin with.
export default function KitImportDialog({ files, picked, lanes, initial, onApply, freeRows = 0, onAddRow, source, onImported, onClose }: KitImportDialogProps) {
  const [choice, setChoice] = useState(() => initial ?? matchKit(files.map(file => file.name)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = lanes.filter(lane => choice[lane.id] !== undefined);
  const onLanes = new Set(Object.values(choice));
  const leftOver = files.map((_, index) => index).filter(index => !onLanes.has(index));
  const [rowFor, setRowFor] = useState<Set<number>>(() => {
    const used = new Set(Object.values(initial ?? matchKit(files.map(file => file.name))));
    return new Set(files.map((_, index) => index).filter(index => !used.has(index)).slice(0, onAddRow ? freeRows : 0));
  });
  const newRows = leftOver.filter(index => rowFor.has(index));

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
      for (const index of newRows) {
        const row = onAddRow?.();
        if (!row) break;
        if (!stored.has(index)) stored.set(index, (await saveSample(files[index])).id);
        await onApply(row, stored.get(index)!);
      }
      onImported?.(stored.size);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The kit could not be imported.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Import a drum kit" closeLabel="Close kit import" onClose={busy ? () => {} : onClose}>
      {source && <p role="status">From {source}.</p>}
      <p>
        Each lane will play the file chosen for it here. {source
          ? 'Each file is on the lane it was sent for, or the one its name suggests, so check them and change any that are wrong.'
          : 'The files were matched to lanes by their names, so check them and change any that are wrong.'}
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
      {onAddRow && leftOver.length > 0 && (
        <>
          <h3>Files on no lane</h3>
          <p>{freeRows > 0 ? `Each can have a row of its own after the eight drums: ${freeRows === 1 ? 'one more row' : `up to ${freeRows} more rows`} can be added.` : 'The kit has all sixteen rows already, so these are left out.'}</p>
          {leftOver.map(index => {
            const on = rowFor.has(index), full = !on && newRows.length >= freeRows;
            return (
              <div key={index} className="rack-list-row" role="group" aria-label={files[index].name}>
                <span>{files[index].name}</span>
                <Toggle
                  label={`A new row for ${files[index].name}`}
                  checked={on}
                  disabled={busy || full}
                  title={full ? 'There is no row left to add' : 'Add a row after the eight drums that plays this file'}
                  onChange={(next) => setRowFor(now => { const set = new Set(now); if (next) set.add(index); else set.delete(index); return set; })}
                >
                  New row
                </Toggle>
              </div>
            );
          })}
        </>
      )}
      {picked > files.length && <p role="status">Only the first {MAX_KIT_FILES} of the {picked} audio files are listed.</p>}
      <p className="rack-empty">
        Only the files you put on a lane are kept. They stay in this browser: they are not uploaded, and are not part of project files, share links or your account.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="rack-dialog-actions">
        <button className="rack-btn go" disabled={busy || (chosen.length === 0 && newRows.length === 0)} onClick={() => { void apply(); }}>{busy ? 'Importing…' : 'Use These Sounds'}</button>
      </div>
    </Dialog>
  );
}
