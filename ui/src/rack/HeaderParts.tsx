import { useState, useCallback, useRef, useEffect } from 'react';
import { SavedPatternInfo } from '../types';
import Dialog from './Dialog';

export function TempoDisplay({ tempo, onChange }: { tempo: number; onChange: (bpm: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(tempo));
  const inputRef = useRef<HTMLInputElement>(null);
  const tapTimesRef = useRef<number[]>([]);
  const [tapFlash, setTapFlash] = useState(false);

  useEffect(() => {
    if (!editing) setValue(String(tempo));
  }, [tempo, editing]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  const commit = () => {
    const bpm = parseInt(value, 10);
    if (!isNaN(bpm) && bpm >= 20 && bpm <= 400) onChange(bpm);
    setEditing(false);
  };

  const handleTap = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    taps.push(now);

    if (taps.length > 8) taps.shift();

    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      intervals.sort((a, b) => a - b);
      const mid = Math.floor(intervals.length / 2);
      const trimmed = intervals.length > 2
        ? intervals.slice(Math.max(0, mid - 1), mid + 1)
        : intervals;
      const avgInterval = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      const bpm = Math.round(60000 / avgInterval);
      if (bpm >= 20 && bpm <= 400) {
        onChange(bpm);
      }
    }

    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 100);

    if (taps.length > 1) {
      const lastInterval = taps[taps.length - 1] - taps[taps.length - 2];
      if (lastInterval > 3000) {
        tapTimesRef.current = [now];
      }
    }
  }, [onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Plain T is a note on the computer-keyboard piano.
      if (event.key.toLowerCase() === 't' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        event.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTap]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="tempo-led-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }

  return (
    <div className="tempo-display-group">
      <div className={`tempo-led ${tapFlash ? 'tap-flash' : ''}`} onClick={() => setEditing(true)}>
        <span className="tempo-led-label">BPM</span>
        <span className="tempo-led-value">{String(tempo).padStart(3, ' ')}</span>
      </div>
      <button className="rack-btn tap-tempo-btn" onClick={handleTap} title="Tap Tempo (Shift+T)">
        TAP
      </button>
    </div>
  );
}

export function SavePattern({
  saving, setSaving, saveName, setSaveName, savedFeedback, setSavedFeedback, onSave,
}: {
  saving: boolean;
  setSaving: (v: boolean) => void;
  saveName: string;
  setSaveName: (v: string) => void;
  savedFeedback: boolean;
  setSavedFeedback: (v: boolean) => void;
  onSave: (name: string) => Promise<boolean>;
}) {
  const handleSaveCommit = async () => {
    const name = saveName.trim();
    if (!name) { setSaving(false); return; }
    const saved = await onSave(name);
    setSaving(false);
    if (saved) {
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2000);
    }
  };

  if (savedFeedback) {
    return <span className="save-feedback">&#10003; Saved!</span>;
  }

  if (saving) {
    return (
      <div className="save-inline">
        <input
          autoFocus
          className="save-name-input"
          placeholder="Pattern name..."
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveCommit(); if (e.key === 'Escape') setSaving(false); }}
        />
        <button className="save-confirm-btn" onClick={() => void handleSaveCommit()}>&#10003;</button>
        <button className="save-cancel-btn" onClick={() => setSaving(false)}>&#10005;</button>
      </div>
    );
  }

  return (
    <button className="rack-btn save-button" onClick={() => { setSaving(true); setSaveName(''); }}>
      + Save
    </button>
  );
}

export function LoadPattern({
  loading,
  savedPatterns,
  onLoad,
  onRefresh,
}: {
  loading: boolean;
  savedPatterns: SavedPatternInfo[];
  onLoad: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="load-inline">
      <select
        className="load-select"
        defaultValue=""
        onFocus={onRefresh}
        onChange={(e) => {
          if (!e.target.value) return;
          onLoad(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>{loading ? 'Loading...' : 'Load'}</option>
        {savedPatterns.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Dialog title="How to use Discobot" closeLabel="Close help" onClose={onClose}>
      <div className="help-sections">
        <section>
          <h3>Quick start</h3>
          <ol className="help-list">
            <li>Everything runs in your browser. No account or server is needed, and it works offline after the first visit.</li>
            <li>The rack is read top to bottom: transport, three synth lanes, the drum grid, then the shared effects. Every lane's steps line up.</li>
            <li>Click a synth lane's name plate to open its editor. Select a step in its row, then play a key to put a note on it.</li>
            <li>Click cells in the drum grid to add hits. The strip under the grid edits the instrument and step you last touched.</li>
            <li>Press <strong>Play All</strong> to start and <strong>Stop All</strong> to stop.</li>
          </ol>
        </section>
        <section>
          <h3>Top row</h3>
          <ul className="help-list help-list-plain">
            <li><strong>BPM:</strong> click the display to type a tempo (20–400), or tap it in with <strong>Tap</strong>.</li>
            <li><strong>Save / Load:</strong> store and recall the whole arrangement in this browser.</li>
            <li><strong>Project menu:</strong> export or import a project file (a backup you can move to another device; imported samples are not included), import a MIDI file, manage saved arrangements, or reset everything.</li>
            <li><strong>Export menu:</strong> WAV (one bar with its effect tail), Loop WAV (exactly one bar that repeats seamlessly), Stems (a zip with one WAV per synth lane and one for the drums) and MIDI are of the open scene. Song WAV and Song MIDI are the whole song.</li>
            <li><strong>MIDI:</strong> choose a controller, channel, target lane and live/record/step mode. Imported samples are kept there too.</li>
          </ul>
        </section>
        <section>
          <h3>Scenes and song</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Scenes:</strong> a scene is one bar of everything: the notes on all three lanes and the drum grid. <strong>+ Copy</strong> adds one that starts the same as the open scene; <strong>+ Empty</strong> adds a blank one. Sounds, tempo and effects are shared by every scene.</li>
            <li><strong>Song:</strong> <strong>+ Add</strong> puts the open scene at the end of the song. Each block has − and + for how many times it repeats, arrows to move it, and ✕ to remove it.</li>
            <li><strong>Scene / Song:</strong> in Scene, Play loops the open scene. In Song, Play runs the song from the block you last clicked and the rack follows it. Tick Loop to start again at the end.</li>
          </ul>
        </section>
        <section>
          <h3>Synth lanes</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Lane knobs:</strong> the four you reach for most, plus Level. Choosing a synth model swaps them for that model's own four.</li>
            <li><strong>Editor tabs:</strong> Notes (keyboard or piano roll, step velocity and slide), then Osc, Filter, Amp, LFO, Arp and Sends for the full sound.</li>
            <li><strong>Thicker and punchier:</strong> Unison (Osc tab) stacks detuned copies of each note. The filter has a 12 dB and a steeper 24 dB slope. Duck (Sends tab) dips the lane on every kick so the kick cuts through.</li>
            <li><strong>Presets:</strong> save, load and delete sounds without touching the pattern.</li>
          </ul>
        </section>
        <section>
          <h3>Drums</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Step details:</strong> each hit has a velocity, a chance of playing, and a repeat count that packs 2 to 4 hits into the step. Shift+click a hit to step through velocities.</li>
            <li><strong>More / Sends:</strong> show the humanize and pan knobs, and the kit's effect sends.</li>
          </ul>
        </section>
        <section>
          <h3>Keys</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Play notes from the computer keyboard:</strong> the A S D F G H J K L row is the white keys and W E T Y U O P the black keys, on the open lane. Z and X shift the octave.</li>
            <li><strong>Move along the steps:</strong> with a step selected, the left and right arrow keys select the one before or after it.</li>
            <li><strong>Tap tempo:</strong> Shift + T</li>
            <li><strong>Undo:</strong> Ctrl/Cmd + Z. <strong>Redo:</strong> Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y. They step back through note, sound, drum, tempo and effects edits in the order you made them.</li>
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
