import { useState, useCallback, useRef, useEffect, useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Dialog from './Dialog';
import { helpCount, helpWords, matchHelp, type HelpSection } from '../services/helpSearch';

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

export function HelpModal({ open, onClose, onWalkthrough }: { open: boolean; onClose: () => void; onWalkthrough: () => void }) {
  if (!open) return null;
  return <HelpContent onClose={onClose} onWalkthrough={onWalkthrough} />;
}

function HelpContent({ onClose, onWalkthrough }: { onClose: () => void; onWalkthrough: () => void }) {
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<HelpSection[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentsRef = useRef<HTMLElement>(null);

  // The headings and the words searched are read from the sections as they are written below,
  // so there is one copy of each.
  useLayoutEffect(() => {
    setSections(Array.from(bodyRef.current?.querySelectorAll('section') || []).map(section => ({
      id: section.id,
      title: section.querySelector('h3')?.textContent || '',
      text: section.textContent || '',
    })));
  }, []);

  const searching = helpWords(query).length > 0;
  const found = matchHelp(sections, query);
  const off = (id: string) => searching && !found.includes(id);
  const listed = sections.filter(section => !off(section.id));

  const jump = (id: string) => {
    const section = bodyRef.current?.querySelector<HTMLElement>(`#${id}`);
    section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
  };
  // A heading is not a Tab stop, so Tab from one would leave the dialog: it goes back to the list.
  const back = (event: ReactKeyboardEvent<HTMLHeadingElement>, id: string) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    // Kept from the dialog's own Tab handling, which would see the list's last button focused and wrap to the first.
    event.stopPropagation();
    contentsRef.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)?.focus();
  };
  const clear = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  return (
    <Dialog title="How to use Discobot" closeLabel="Close help" onClose={onClose}>
      <div className="rack-dialog-actions start">
        <button className="rack-btn go" title="A short tour of the rack, one part at a time" onClick={onWalkthrough}>Show the Walkthrough</button>
      </div>
      <div className="account-field help-search">
        <label htmlFor="help-search">Search Help</label>
        <div className="help-search-row">
          <input ref={searchRef} id="help-search" type="text" value={query} autoComplete="off" spellCheck={false} enterKeyHint="search" onChange={(event) => setQuery(event.target.value)} />
          <button className="rack-btn" aria-label="Clear search" disabled={!query} onClick={clear}>Clear</button>
        </div>
        <p className="help-count" role="status">{helpCount(found.length, sections.length, query)}</p>
      </div>
      {listed.length > 0 && (
        <nav ref={contentsRef} className="help-contents" aria-label="Help sections">
          {listed.map(section => (
            <button key={section.id} className="rack-btn" data-section={section.id} onClick={() => jump(section.id)}>{section.title}</button>
          ))}
        </nav>
      )}
      <div ref={bodyRef} className="help-sections">
        <section id="help-start" hidden={off('help-start')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-start')}>Quick start</h3>
          <ol className="help-list">
            <li>Everything runs in your browser. No account or server is needed, and it works offline after the first visit.</li>
            <li>The rack is read top to bottom: transport, three synth lanes, the drum grid, then the shared effects. Every lane's steps line up.</li>
            <li>Click a synth lane's name plate to open its editor. Select a step in its row, then play a key to put a note on it.</li>
            <li>Click cells in the drum grid to add hits. The strip under the grid edits the instrument and step you last touched.</li>
            <li>Press <strong>Play All</strong> to start and <strong>Stop All</strong> to stop. The Space bar does the same, unless a button, a field or a dialog has the keyboard.</li>
          </ol>
        </section>
        <section id="help-top" hidden={off('help-top')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-top')}>Top row</h3>
          <ul className="help-list help-list-plain">
            <li><strong>BPM:</strong> click the display to type a tempo (20–400), or tap it in with <strong>Tap</strong>.</li>
            <li><strong>Click / Count:</strong> Click is a metronome, a tick on every beat while playing. Count plays one bar of ticks before anything starts. Neither is in an export.</li>
            <li><strong>Projects:</strong> the small word beside the project's name says where its work is: Saved (in this browser), In account (signed in, and the account has this version), Browser only (signed in, but this project is not in the account), Saving, or Not saving when another tab has the project. Click the project's name to see every project in this browser. The open project saves itself as you work; <strong>Copy</strong> keeps a version to go back to. Arrangements saved in earlier versions are now projects.</li>
            <li><strong>Project menu:</strong> start a new project, share a link, export or import a project file (a backup you can move to another device; imported samples are not included), import a MIDI file, or reset the open project.</li>
            <li><strong>Kids Mode:</strong> in the Project menu. Big pads, a picture grid for building a beat and one play button for a small child, on a page of its own that cannot change your projects. Hold “Hold to leave” for three seconds to come back.</li>
            <li><strong>Working together:</strong> signed in, <strong>Share</strong> beside a project in your account lets someone else with an account open it and save changes. You take turns; if you both change it at once, both versions are kept. Projects shared with you are listed under your own, and nothing arrives until you open it.</li>
            <li><strong>Share Link:</strong> makes a link with the whole song inside it. Whoever opens it can listen and keep their own copy. Nothing is uploaded, and no account is needed.</li>
            <li><strong>Export:</strong> choose the open scene or the whole song, and audio, a seamless loop, stems or MIDI; it says how long the file will be and shows it being made. The kinds are Scene WAV (one bar with its effect tail), Loop WAV (exactly one bar that repeats seamlessly), Stems (a zip with one WAV per synth lane and one for the drums) and Scene MIDI are of the open scene. Song WAV and Song MIDI are the whole song. A WAV export can take a while for a long song: a message at the top says it is being made and when it is done, and the other WAV exports wait until it is.</li>
            <li><strong>MIDI:</strong> choose a controller, channel, target lane and live/record/step mode. Imported samples are kept there too.</li>
          </ul>
        </section>
        <section id="help-scenes" hidden={off('help-scenes')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-scenes')}>Scenes and song</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Scenes:</strong> a scene is one bar of everything: the notes on all three lanes and the drum grid. <strong>+ Copy</strong> adds one that starts the same as the open scene; <strong>+ Empty</strong> adds a blank one. Sounds, tempo and effects are shared by every scene.</li>
            <li><strong>Song:</strong> <strong>+ Add</strong> puts the open scene at the end of the song. Each block has − and + for how many times it repeats, arrows to move it, and ✕ to remove it.</li>
            <li><strong>Scene / Song:</strong> in Scene, Play loops the open scene. In Song, Play runs the song from the block you last clicked and the rack follows it. Tick Loop to start again at the end.</li>
          </ul>
        </section>
        <section id="help-lanes" hidden={off('help-lanes')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-lanes')}>Synth lanes</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Lane knobs:</strong> the four you reach for most, plus Level. Choosing a synth model swaps them for that model's own four.</li>
            <li><strong>Longer patterns:</strong> each lane's Notes tab and the drum strip have a Bars menu (1, 2, 4 or 8). A longer pattern is shown a bar at a time; pick the bar with the numbered buttons, or turn on Follow to watch the one that is playing. Lanes of different lengths loop against each other.</li>
            <li><strong>Editor tabs:</strong> Notes (keyboard or piano roll, each step's velocity, slide, chance, repeats, timing and note length; in the piano roll, click several notes in one column for a chord and drag a note's right edge to lengthen it), then Osc, Filter, Amp, LFO, Arp and Sends for the full sound.</li>
            <li><strong>Thicker and punchier:</strong> Unison (Osc tab) stacks detuned copies of each note. The filter has a 12 dB and a steeper 24 dB slope. Duck (Sends tab) dips the lane on every kick so the kick cuts through.</li>
            <li><strong>Presets:</strong> save, load and delete sounds without touching the pattern.</li>
          </ul>
        </section>
        <section id="help-drums" hidden={off('help-drums')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-drums')}>Drums</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Step details:</strong> each hit has a velocity, a chance of playing, and a repeat count that packs 2 to 4 hits into the step. Shift+click a hit to step through velocities.</li>
            <li><strong>More / Sends:</strong> show the humanize and pan knobs, and the kit's effect sends.</li>
            <li><strong>Your own sounds:</strong> <strong>Sound</strong> puts an imported sample on the selected lane. <strong>Import Kit</strong> takes several files at once and matches each to a lane by its name, such as “Kick” or “HH Open”; check the matches before using them. Samples stay in this browser.</li>
          </ul>
        </section>
        <section id="help-keys" hidden={off('help-keys')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-keys')}>Keys</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Play notes from the computer keyboard:</strong> the A S D F G H J K L row is the white keys and W E T Y U O P the black keys, on the open lane. Z and X shift the octave.</li>
            <li><strong>Move along the steps:</strong> with a step selected, the left and right arrow keys select the one before or after it.</li>
            <li><strong>Play and stop:</strong> Space, as the Play All button does. When a button has the keyboard, Space presses that button instead; in a text field it types a space.</li>
            <li><strong>Tap tempo:</strong> Shift + T</li>
            <li><strong>Undo:</strong> Ctrl/Cmd + Z. <strong>Redo:</strong> Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y. They step back through note, sound, drum, tempo and effects edits in the order you made them.</li>
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
