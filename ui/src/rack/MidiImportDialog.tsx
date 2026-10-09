import type { Studio } from '../studio/useStudio';
import Dialog from './Dialog';

export default function MidiImportDialog({ studio }: { studio: Studio }) {
  const { midiImportData, midiImportAssignments, setMidiImportAssignments, setMidiImportData, handleMidiImportApplyAll } = studio;
  if (!midiImportData) return null;
  return (
    <Dialog title="Import MIDI" closeLabel="Close MIDI import" onClose={() => setMidiImportData(null)}>
      <p>
        Detected tempo: <strong>{midiImportData.detectedTempo} BPM</strong> &middot; Length: <strong>{midiImportData.bars} {midiImportData.bars === 1 ? 'bar' : 'bars'}</strong> &middot; Steps per bar: <strong>{midiImportData.detectedStepCount}</strong>
      </p>
      {midiImportData.truncated && <p role="status">This file is longer than 8 bars. Only its first 8 bars are imported.</p>}
      <p className="rack-empty">Assign each track to a synth or the drums:</p>
      {midiImportData.tracks.map((track, index) => (
        <div key={index} className="rack-list-row">
          <span>{track.name}</span>
          <span className="rack-empty">{track.noteCount} notes</span>
          <select
            aria-label={`Destination for ${track.name}`}
            value={midiImportAssignments[index] ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setMidiImportAssignments(prev => ({ ...prev, [index]: value === '' ? null : value === 'drums' ? 'drums' : Number(value) }));
            }}
          >
            <option value="">Skip</option>
            {track.drums
              ? <option value="drums">Drum Machine</option>
              : [1, 2, 3].map(id => <option key={id} value={id}>Synth {id}</option>)}
          </select>
        </div>
      ))}
      <div className="rack-dialog-actions">
        <button className="rack-btn go" onClick={() => { void handleMidiImportApplyAll(); }}>Apply All</button>
      </div>
    </Dialog>
  );
}
