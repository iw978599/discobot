import { useEffect, useState, useSyncExternalStore } from 'react';
import { elapsed, sessionRecorder } from '../services/sessionRecorder';

// Records what this browser hears, from now until pressed again, onto a new audio track called
// Session (roadmap V24). Lit while recording, with how long it has been. Not shown in a browser
// that cannot record its own sound.
export default function SessionRecordButton({ onToggle }: { onToggle: () => void }) {
  const state = useSyncExternalStore(sessionRecorder.subscribe, sessionRecorder.get);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!state.recording) return;
    const timer = setInterval(() => redraw(count => count + 1), 1000);
    return () => clearInterval(timer);
  }, [state.recording]);
  if (!sessionRecorder.supported()) return null;
  return (
    <button
      className={`rack-btn record-session ${state.recording ? 'on' : ''}`}
      aria-pressed={state.recording}
      onClick={onToggle}
      title={state.recording ? 'Stop, and put what was recorded on a new audio track' : 'Record everything this browser hears, everyone\'s notes in a live session included, onto a new audio track'}
    >
      {state.recording ? 'Stop Recording' : '● Record Session'}
      {state.recording && <span className="record-session-time" aria-hidden="true">{elapsed(state.startedAt)}</span>}
    </button>
  );
}
