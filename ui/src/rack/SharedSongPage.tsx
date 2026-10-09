import { useEffect, useMemo, useState } from 'react';
import { localService } from '../services/localService';
import { songBars, songLengthBars } from '../services/songPlayback';
import { sceneBars } from '../services/patternLength';
import { renderArrangementWav } from '../services/wavExport';
import './rack.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

interface SharedSongPageProps {
  file: unknown;
  // Set for a published song: the username it was published under.
  author?: string;
  // Why a published song could not be fetched.
  error?: string;
  onOpenCopy: () => void;
  onLeave: () => void;
}

// What someone sees when they open a share link: the song, a way to hear it, and a way to
// keep it. Nothing here touches the visitor's own projects until they ask for a copy.
export default function SharedSongPage({ file, author, error: fetchError, onOpenCopy, onLeave }: SharedSongPageProps) {
  const read = useMemo(() => localService.readProjectFile(file), [file]);
  const [audioUrl, setAudioUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'failed'>('idle');
  const [error, setError] = useState('');

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  if (!read.ok) {
    return (
      <div className="rack-page shared-page">
        <main className="rack-unit shared-card">
          <h1>This link could not be opened</h1>
          <p role="alert">{fetchError || read.error}</p>
          <button className="rack-btn go" onClick={onLeave}>Go to Discobot</button>
        </main>
      </div>
    );
  }

  const project = read.project;
  const bars = songLengthBars(project.song, sceneId => { const scene = project.scenes.find(entry => entry.id === sceneId); return scene ? sceneBars(scene) : 1; });
  const laneCount = project.synths.filter(synth => project.scenes.some(scene => scene.lanes[synth.synthId]?.some(step => step.active && step.note))).length;

  const listen = async () => {
    setStatus('rendering');
    setError('');
    // Let the "Preparing" message paint before the render takes over the page.
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      const wav = await renderArrangementWav({
        tempo: project.tempo, drumState: project.drumState, drumKitId: project.selectedDrumKitId,
        drumMasterVolume: project.drumMasterVolume, drumSwing: project.drumSwing, drumFx: project.drumFx, effectsLoop: project.effectsLoop,
        synths: project.synths.map(synth => ({ id: synth.synthId, pattern: synth.pattern, synthParams: synth.synthParams, muted: synth.muted, solo: synth.solo })),
        bars: songBars(project.song, project.scenes),
      });
      setAudioUrl(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
      setStatus('idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The song could not be played.');
      setStatus('failed');
    }
  };

  return (
    <div className="rack-page shared-page">
      <main className="rack-unit shared-card" aria-label="Shared song">
        <span className="shared-eyebrow">{author ? `A song by ${author}, made in Discobot` : 'A song shared from Discobot'}</span>
        <h1>{project.name}</h1>
        <p className="shared-facts">
          {project.tempo} BPM · {bars} {bars === 1 ? 'bar' : 'bars'} · {clock(bars * 240 / project.tempo)}
          {' · '}{project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'}
          {' · '}{laneCount === 0 ? 'drums' : `${laneCount} synth ${laneCount === 1 ? 'lane' : 'lanes'} and drums`}
        </p>
        <div className="shared-song-order" aria-label="Song order">
          {project.song.entries.map((entry, index) => (
            <span key={index}>{project.scenes.find(scene => scene.id === entry.sceneId)?.name ?? '?'} ×{entry.repeats}</span>
          ))}
        </div>
        {audioUrl
          ? <audio controls autoPlay src={audioUrl} aria-label={`${project.name}, audio`} />
          : (
            <button className="rack-btn go shared-play" disabled={status === 'rendering'} onClick={() => { void listen(); }}>
              {status === 'rendering' ? 'Preparing the song…' : '▶ Listen'}
            </button>
          )}
        {error && <p role="alert">{error}</p>}
        <div className="shared-actions">
          <button className="rack-btn" onClick={onOpenCopy} title="Add this song to your projects in this browser and open it for editing">Open a Copy to Edit</button>
          <button className="rack-btn" onClick={onLeave}>Go to My Projects</button>
        </div>
        <p className="rack-hint">
          {author ? 'This song was published from Discobot.' : 'This song travelled inside the link you opened.'} It is played by your own browser and has not been saved here;
          choose “Open a Copy to Edit” to keep it.
        </p>
      </main>
    </div>
  );
}
