import { useEffect, useState, useSyncExternalStore } from 'react';
import { elapsed, sessionRecorder, takeMp3, takeWav } from '../services/sessionRecorder';
import { getAudioContext } from '../hooks/browserAudio';
import { downloadFile } from '../services/wavExport';

// Records what this browser hears, from now until pressed again, onto a new audio track called
// Session (roadmap V24). Lit while recording, with how long it has been. Once a take is finished, a
// second button saves it as a WAV file as well, and a third as a 320 kb/s MP3. Not shown in a browser that cannot record its own
// sound.
export default function SessionRecordButton({ onToggle }: { onToggle: () => void }) {
  const state = useSyncExternalStore(sessionRecorder.subscribe, sessionRecorder.get);
  const [, redraw] = useState(0);
  // What is being made, and how far the MP3 has got (0 to 1).
  const [saving, setSaving] = useState<'wav' | 'mp3' | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<'wav' | 'mp3' | null>(null);
  useEffect(() => {
    if (!state.recording) return;
    const timer = setInterval(() => redraw(count => count + 1), 1000);
    return () => clearInterval(timer);
  }, [state.recording]);
  useEffect(() => { setFailed(null); }, [state.take]);
  if (!sessionRecorder.supported()) return null;
  const take = state.take;
  const download = async (kind: 'wav' | 'mp3') => {
    if (!take) return;
    setSaving(kind);
    setProgress(0);
    setFailed(null);
    try {
      const file = kind === 'wav'
        ? takeWav(take, await getAudioContext().decodeAudioData(await take.arrayBuffer()))
        : await takeMp3(take, setProgress);
      downloadFile(file, file.type, file.name);
    } catch {
      setFailed(kind);
    } finally {
      setSaving(null);
    }
  };
  const plainName = take?.name.replace(/.[^.]+$/, '');
  return (
    <>
      <button
        className={`rack-btn record-session ${state.recording ? 'on' : ''}`}
        aria-pressed={state.recording}
        onClick={onToggle}
        title={state.recording ? 'Stop, and put what was recorded on a new audio track' : 'Record everything this browser hears, everyone\'s notes in a live session included, onto a new audio track'}
      >
        {state.recording ? 'Stop Recording' : '● Record Session'}
        {state.recording && <span className="record-session-time" aria-hidden="true">{elapsed(state.startedAt)}</span>}
      </button>
      {!state.recording && take && (
        <>
          <button className="rack-btn" disabled={saving !== null} onClick={() => { void download('wav'); }} title={`Save ${plainName} as a WAV file`}>
            {saving === 'wav' ? 'Making WAV…' : 'Download Session WAV'}
          </button>
          <button className="rack-btn" disabled={saving !== null} onClick={() => { void download('mp3'); }} title={`Save ${plainName} as a high-quality MP3 file (320 kb/s)`}>
            {saving === 'mp3' ? `Making MP3… ${Math.round(progress * 100)}%` : 'Download Session MP3'}
          </button>
        </>
      )}
      {failed && <span className="record-session-error" role="alert">The recording could not be made into {failed === 'wav' ? 'a WAV' : 'an MP3'}.</span>}
    </>
  );
}
