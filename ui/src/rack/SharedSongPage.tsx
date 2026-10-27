import { useEffect, useMemo, useState } from 'react';
import { localService } from '../services/localService';
import { applySceneMutes, songBars, songLengthBars, songRows, songSeconds } from '../services/songPlayback';
import { sceneBars } from '../services/patternLength';
import { renderArrangementWav } from '../services/wavExport';
import { loadCymbals, loadLaneSamples, loadSoundSamples } from '../services/builtInWaves';
import { soundIn } from '../services/sceneSounds';
import { USER_PREFIX, userName } from '../services/shareLink';
import SongPlayer from './SongPlayer';
import SongTimeline, { type TimelineEntry } from './SongTimeline';
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
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  // Each entry of the song, where it starts and how long it lasts, for the timeline.
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!read.ok) return [];
    const { scenes, song, tempo } = read.project;
    const sceneOf = (sceneId: string) => scenes.find(scene => scene.id === sceneId);
    return songRows(song, sceneId => { const scene = sceneOf(sceneId); return scene ? sceneBars(scene) : 1; }, tempo, sceneId => sceneOf(sceneId)?.signature, sceneId => sceneOf(sceneId)?.tempo)
      .map(row => ({ ...row, name: sceneOf(row.sceneId)?.name ?? '?', color: sceneOf(row.sceneId)?.color }));
  }, [read]);

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
  const lengthOf = (sceneId: string) => { const scene = project.scenes.find(entry => entry.id === sceneId); return scene ? sceneBars(scene) : 1; };
  const bars = songLengthBars(project.song, lengthOf);
  // A bar lasts as long as its scene's time signature and tempo make it.
  const sceneOf = (sceneId: string) => project.scenes.find(entry => entry.id === sceneId);
  const seconds = songSeconds(project.song, lengthOf, project.tempo, sceneId => sceneOf(sceneId)?.signature, sceneId => sceneOf(sceneId)?.tempo);
  const laneCount = project.synths.filter(synth => project.scenes.some(scene => scene.lanes[synth.synthId]?.some(step => step.active && step.note))).length;

  const listen = async () => {
    setStatus('rendering');
    setError('');
    // Let the "Preparing" message paint before the render takes over the page.
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      const wav = await renderArrangementWav({
        tempo: project.tempo, drumState: project.drumState, drumKitId: project.selectedDrumKitId,
        drumMasterVolume: project.drumMasterVolume, drumSwing: project.drumSwing, drumSwingGrid: project.drumSwingGrid, drumFx: project.drumFx, effectsLoop: project.effectsLoop,
        // Each lane's shared sound; a scene with one of its own brings it in its bars.
        synths: project.synths.map(synth => ({ id: synth.synthId, pattern: synth.pattern, synthParams: soundIn(null, synth.synthId, synth), muted: false, solo: false, swing: synth.swing })),
        bars: applySceneMutes(songBars(project.song, project.scenes), project.synths.map(synth => ({ id: synth.synthId, muted: synth.muted, solo: synth.solo }))),
        // The app's own waves come with it, so a lane that plays one sounds here as it did when shared.
        drumCymbals: await loadCymbals(),
        synthSamples: await loadLaneSamples(project.synths.map(synth => ({ id: synth.synthId, synthParams: soundIn(null, synth.synthId, synth) }))),
        soundSamples: await loadSoundSamples(project.synths.flatMap(synth => project.scenes.flatMap(scene => (scene.sounds?.[synth.synthId] ? [scene.sounds[synth.synthId].synthParams] : [])))),
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
        <span className="shared-eyebrow">
          {!author ? 'A song shared from Discobot'
            : userName(`${USER_PREFIX}${author}`) ? <>A song by <a href={`${USER_PREFIX}${author}`} title={`The songs ${author} has published`}>{author}</a>, made in Discobot</>
              : `A song by ${author}, made in Discobot`}
        </span>
        <h1>{project.name}</h1>
        <p className="shared-facts">
          {project.tempo} BPM · {bars} {bars === 1 ? 'bar' : 'bars'} · {clock(seconds)}
          {' · '}{project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'}
          {' · '}{laneCount === 0 ? 'drums' : `${laneCount} synth ${laneCount === 1 ? 'lane' : 'lanes'} and drums`}
        </p>
        <SongTimeline entries={timeline} audio={audio} />
        {audioUrl
          ? <SongPlayer src={audioUrl} label={`${project.name}, audio`} onAudio={setAudio} />
          : (
            <button className="rack-btn go shared-play" disabled={status === 'rendering'} onClick={() => { void listen(); }}>
              {status === 'rendering' ? 'Preparing the song…' : '▶ Listen'}
            </button>
          )}
        {error && <p role="alert">{error}</p>}
        {(project.audioTracks ?? []).some(track => track.clips.length > 0) && (
          <p className="rack-hint">This song has audio tracks of recordings. A link carries no recordings, so they are not heard here; a copy opened to edit has the tracks without their sound.</p>
        )}
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
