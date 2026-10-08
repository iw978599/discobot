import { useEffect, useState } from 'react';
import { deleteSample, listSamples, saveSample, type SampleRecord } from '../services/sampleStore';
import { stopAllSamples } from '../hooks/browserAudio';
import './SamplePanel.css';

export default function SamplePanel({ onPlay }: { onPlay: (sample: SampleRecord) => void | Promise<void> }) {
  const [samples, setSamples] = useState<SampleRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    listSamples().then(result => { if (mounted) setSamples(result); })
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : 'Sample storage unavailable'); });
    return () => { mounted = false; };
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sample operation failed'); }
    finally { setBusy(false); }
  };
  return (
    <section className="sample-panel" aria-label="Sampler">
      <h2>Sampler</h2>
      <label className="sample-upload">
        Import audio sample (up to 50 MB)
        <input
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
          aria-label="Import audio sample"
          disabled={busy}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            void perform(async () => {
              await saveSample(file);
              setSamples(await listSamples());
            });
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {busy && <span role="status">Working…</span>}
      <button onClick={() => stopAllSamples()}>Stop All</button>
      {samples.length === 0 && <p>No samples yet. Imported audio stays on this device.</p>}
      <ul className="sample-list">
        {samples.map(sample => (
          <li key={sample.id}>
            <span>{sample.name}</span>
            <button disabled={busy} aria-label={`Play sample ${sample.name}`} onClick={() => { void perform(async () => { await onPlay(sample); }); }}>Play</button>
            <button disabled={busy} aria-label={`Delete sample ${sample.name}`} onClick={() => { void perform(async () => { stopAllSamples(); await deleteSample(sample.id); setSamples(await listSamples()); }); }}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
