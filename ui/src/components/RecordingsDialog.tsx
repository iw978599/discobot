import { useState } from 'react';
import Dialog from '../rack/Dialog';
import { instrumentName, noteFromName, noteLabel, type Recording } from '../services/multiSample';

interface RecordingsDialogProps {
  recordings: Recording[];
  onImport: (name: string, recordings: Array<Recording & { note: number }>) => void;
  onClose: () => void;
}

const NOTES = Array.from({ length: 128 }, (_, note) => note);

// Several recordings made into one instrument (roadmap 22): the note each one is, guessed from its
// file's name and shown to be changed, as Import Kit shows its guesses. Nothing is kept until Import.
export default function RecordingsDialog({ recordings, onImport, onClose }: RecordingsDialogProps) {
  const [name, setName] = useState(() => instrumentName(recordings.map(recording => recording.name)));
  const [notes, setNotes] = useState<Array<number | undefined>>(() => recordings.map(recording => noteFromName(recording.name)));
  const taken = (note: number | undefined, index: number) => note !== undefined && notes.some((other, at) => at !== index && other === note);
  const ready = notes.every((note, index) => note !== undefined && !taken(note, index)) && name.trim() !== '';
  const missing = notes.filter(note => note === undefined).length;
  return (
    <Dialog title="Import several recordings" closeLabel="Close" onClose={onClose} initialFocus="input" small>
      <p>Each recording plays the notes nearest it. Say which note each one is.</p>
      <label className="recordings-name">
        Name
        <input aria-label="Instrument name" value={name} maxLength={60} onChange={event => setName(event.target.value)} />
      </label>
      <ul className="recordings-list">
        {recordings.map((recording, index) => (
          <li key={index} className="recordings-row" data-clash={taken(notes[index], index) ? 'true' : undefined}>
            <span className="recordings-file" title={recording.name}>{recording.name}</span>
            <select
              aria-label={`Note of ${recording.name}`}
              value={notes[index] ?? ''}
              onChange={event => setNotes(notes.map((note, at) => (at === index ? (event.target.value === '' ? undefined : Number(event.target.value)) : note)))}
            >
              <option value="">Choose…</option>
              {NOTES.map(note => <option key={note} value={note}>{noteLabel(note)}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <p className="recordings-state" role="status">
        {missing > 0 ? `${missing} ${missing === 1 ? 'recording needs' : 'recordings need'} a note.` : notes.some((note, index) => taken(note, index)) ? 'Two recordings have the same note.' : ''}
      </p>
      <div className="rack-dialog-actions">
        <button className="rack-btn" onClick={onClose}>Cancel</button>
        <button
          className="rack-btn go"
          disabled={!ready}
          onClick={() => onImport(name.trim(), recordings.map((recording, index) => ({ ...recording, note: notes[index] as number })))}
        >
          Import
        </button>
      </div>
    </Dialog>
  );
}
