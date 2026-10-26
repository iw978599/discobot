import { useEffect, useState, useSyncExternalStore } from 'react';
import { elapsed, sessionRecorder, takeWav } from '../services/sessionRecorder';
import { getAudioContext } from '../hooks/browserAudio';
import { downloadFile } from '../services/wavExport';

// Records what this browser hears, from now until pressed again, onto a new audio track called
// Session (roadmap V24). Lit while recording, with how long it has been. Once a take is finished, a
// second button saves it as a WAV file as well. Not shown in a browser that cannot record its own
// sound.
export default function SessionRecordButton({ onToggle }: { onToggle: () => void }) {
  const state = useSyncExternalStore(sessionRecorder.subscribe, sessionRecorder.get);
  const [, redraw] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!state.recording) return;
    const timer = setInterval(() => redraw(count => count + 1), 1000);
    return () => clearInterval(timer);
  }, [state.recording]);
  useEffect(() => { setFailed(false); }, [state.take]);
  if (!sessionRecorder.supported()) return null;
  const take = state.take;
  const download = async () => {
    if (!take) return;
    setSaving(true);
    setFailed(false);
    try {
      const wav = takeWav(take, await getAudioContext().decodeAudioData(await take.arrayBuffer()));
      downloadFile(wav, wav.type, wav.name);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
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
        <button className="rack-btn" disabled={saving} onClick={() => { void download(); }} title={`Save ${take.name.replace(/\.[^.]+$/, '')} as a WAV file`}>
          {saving ? 'Making WAV…' : 'Download Session WAV'}
        </button>
      )}
      {failed && <span className="record-session-error" role="alert">The recording could not be made into a WAV.</span>}
    </>
  );
}
