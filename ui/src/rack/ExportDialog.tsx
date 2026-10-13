import { useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { songLengthBars, songSeconds } from '../services/songPlayback';
import { barQuarters } from '../services/patternLength';
import Dialog from './Dialog';

type What = 'scene' | 'song';
type As = 'audio' | 'loop' | 'stems' | 'midi';

const KINDS: Array<{ id: As; name: string; hint: string; sceneOnly?: boolean }> = [
  { id: 'audio', name: 'Audio', hint: 'One WAV file, with the tail of the effects at the end' },
  { id: 'loop', name: 'Seamless loop', hint: 'A WAV that repeats without a gap, with the effects’ tails wrapped round', sceneOnly: true },
  { id: 'stems', name: 'Stems', hint: 'Each synth lane, the drums and each guest as its own WAV, in a zip', sceneOnly: true },
  { id: 'midi', name: 'MIDI', hint: 'The notes as a MIDI file, for another program. No sound is in it' },
];
// What each choice is called where an export is spoken of: the message while it is made, Help.
const NAMES: Record<What, Record<As, string>> = {
  scene: { audio: 'Scene WAV', loop: 'Loop WAV', stems: 'Stems', midi: 'Scene MIDI' },
  song: { audio: 'Song WAV', loop: 'Song WAV', stems: 'Song WAV', midi: 'Song MIDI' },
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// Export in one place: what (the open scene or the whole song), as what, how long it will be, and
// the making of it reported where it was asked for. The same handlers do the work as before.
export default function ExportDialog({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [what, setWhat] = useState<What>('scene');
  const [chosen, setChosen] = useState<As>('audio');
  // A loop and stems are of one scene: with the song chosen it is the plain audio file.
  const as = what === 'song' && KINDS.find(kind => kind.id === chosen)?.sceneOnly ? 'audio' : chosen;
  const status = studio.exportStatus;
  const working = status?.phase === 'working';
  const bars = what === 'song' ? songLengthBars(studio.song, studio.sceneLength) : studio.sceneLength(studio.currentSceneId);
  // A bar lasts as long as its scene's time signature makes it.
  const seconds = what === 'song' ? songSeconds(studio.song, studio.sceneLength, studio.globalTempo, studio.sceneSignature) : bars * barQuarters(studio.signature) * 60 / studio.globalTempo;
  const length = `${bars} ${bars === 1 ? 'bar' : 'bars'}${what === 'scene' && studio.signature !== '4/4' ? ` of ${studio.signature}` : ''} at ${studio.globalTempo} BPM: ${clock(seconds)}`;

  const run = () => {
    if (as === 'midi') {
      if (what === 'song') void studio.handleExportSongMidi().catch(studio.reportExportError);
      else studio.handleExportMidi();
      return;
    }
    void studio.handleExportWav(what === 'song' ? 'song' : as === 'audio' ? 'pattern' : as).catch(studio.reportExportError);
  };

  return (
    <Dialog title="Export" closeLabel="Close export" onClose={onClose}>
      <div className="export-dialog">
        <fieldset className="export-choice">
          <legend>What</legend>
          <label><input type="radio" name="export-what" checked={what === 'scene'} onChange={() => setWhat('scene')} /> This scene</label>
          <label><input type="radio" name="export-what" checked={what === 'song'} onChange={() => setWhat('song')} /> The whole song</label>
        </fieldset>
        <fieldset className="export-choice">
          <legend>As</legend>
          {KINDS.map(kind => (
            <label key={kind.id} title={kind.hint}>
              <input
                type="radio"
                name="export-as"
                aria-label={kind.name}
                checked={as === kind.id}
                disabled={what === 'song' && kind.sceneOnly}
                onChange={() => setChosen(kind.id)}
              />
              {' '}{kind.name}
              <span className="export-hint">{kind.hint}</span>
            </label>
          ))}
        </fieldset>
        <p className="export-length">
          {length}{as === 'audio' || as === 'stems' ? ', and the tail of the effects after it.' : '.'}
        </p>
        <p className="export-progress" role="status" data-phase={status?.phase ?? 'idle'}>
          {status?.phase === 'working' && `Making ${status.what}${status.part ? ` (${status.part})` : ''}. A long song takes a while; the file downloads when it is done.`}
          {status?.phase === 'done' && `${status.what} finished. The file has been downloaded.`}
        </p>
        <div className="rack-dialog-actions">
          <button className="rack-btn go" disabled={working && as !== 'midi'} title={working && as !== 'midi' ? 'One audio file at a time: wait for the one being made' : `Make ${NAMES[what][as]}`} onClick={run}>
            Export
          </button>
        </div>
      </div>
    </Dialog>
  );
}
