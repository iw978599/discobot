import { useState, useCallback, useRef, useEffect, useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Dialog from './Dialog';
import { helpCount, helpWords, matchHelp, type HelpSection } from '../services/helpSearch';

// Tap tempo: the taps, the Shift+T key, and the flash the display gives each one. It is apart
// from the display because a narrow screen puts the Tap button somewhere else.
export function useTapTempo(onChange: (bpm: number) => void) {
  const tapTimesRef = useRef<number[]>([]);
  const [tapFlash, setTapFlash] = useState(false);

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

  return { tap: handleTap, flash: tapFlash };
}

export function TapButton({ onTap }: { onTap: () => void }) {
  return (
    <button className="rack-btn tap-tempo-btn" onClick={onTap} title="Tap Tempo (Shift+T)">
      TAP
    </button>
  );
}

// `onTap` puts the Tap button beside the display; without it the display stands alone.
export function TempoDisplay({ tempo, onChange, flash, onTap }: { tempo: number; onChange: (bpm: number) => void; flash: boolean; onTap?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(tempo));
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className={`tempo-led ${flash ? 'tap-flash' : ''}`} onClick={() => setEditing(true)}>
        <span className="tempo-led-label">BPM</span>
        <span className="tempo-led-value">{String(tempo).padStart(3, ' ')}</span>
      </div>
      {onTap && <TapButton onTap={onTap} />}
    </div>
  );
}

// `at` is the id of the section to open at, for Help asked for from one unit of the rack.
export function HelpModal({ open, at, onClose, onWalkthrough, onShortcuts }: { open: boolean; at?: string | null; onClose: () => void; onWalkthrough: () => void; onShortcuts: () => void }) {
  if (!open) return null;
  return <HelpContent at={at ?? null} onClose={onClose} onWalkthrough={onWalkthrough} onShortcuts={onShortcuts} />;
}

function HelpContent({ at, onClose, onWalkthrough, onShortcuts }: { at: string | null; onClose: () => void; onWalkthrough: () => void; onShortcuts: () => void }) {
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
  // Opened at a section: its heading takes the keyboard from the button the dialog gave it to,
  // whose effect has already run because the dialog is inside this component.
  useEffect(() => {
    if (at) jump(at);
  }, []);

  return (
    <Dialog title="How to use Discobot" closeLabel="Close help" onClose={onClose}>
      <div className="rack-dialog-actions start">
        <button className="rack-btn go" title="A short tour of the rack, one part at a time" onClick={onWalkthrough}>Show the Walkthrough</button>
        <button className="rack-btn" title="Every keyboard shortcut, with a search (Shift + ?)" onClick={onShortcuts}>Keyboard Shortcuts</button>
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
            <li><strong>Click / Count:</strong> Click is a metronome, a tick on every beat while playing. Count plays a bar of ticks before anything starts; the menu beside it makes that two or four bars, and the Click level knob sets how loud the ticks are. Both are kept in this browser, and neither is in an export.</li>
            <li><strong>Projects:</strong> the small word beside the project's name says where its work is: Saved (in this browser), In account (signed in, and the account has this version), Browser only (signed in, but this project is not in the account), Saving, or Not saving when another tab has the project. Click the project's name to see every project in this browser. The open project saves itself as you work; <strong>Copy</strong> keeps a version to go back to. Arrangements saved in earlier versions are now projects.</li>
            <li><strong>Project menu:</strong> start a new project, share a link, export or import a project file (a backup you can move to another device; imported samples are not included), import a MIDI file, or reset the open project.</li>
            <li><strong>Kids Mode:</strong> in the Project menu. Big pads, a picture grid for building a beat and one play button for a small child, on a page of its own that cannot change your projects. Hold “Hold to leave” for three seconds to come back.</li>
            <li><strong>Working together:</strong> choose <strong>Project → Start Live Session</strong> for the open project. Sign in, add it to your account if asked, and share with a collaborator’s username. They sign in, choose <strong>Project → All Projects → Shared with you → Open</strong> (or Sync Now in Account if it is not listed yet). Shared open projects connect automatically so you can edit and play together; the setup shows who is connected or waiting. Share also grants access after the session; remove a person there to end their access. When disconnected, simultaneous edits keep both versions.</li>
            <li><strong>Share Link:</strong> makes a link with the whole song inside it. Whoever opens it can listen and keep their own copy. Nothing is uploaded, and no account is needed.</li>
            <li><strong>Export:</strong> choose the open scene or the whole song, and audio, a seamless loop, stems or MIDI; it says how long the file will be and shows it being made. The kinds are Scene WAV (one bar with its effect tail), Loop WAV (exactly one bar that repeats seamlessly), Stems (a zip with one WAV per synth lane and one for the drums) and Scene MIDI are of the open scene. Song WAV and Song MIDI are the whole song. A WAV export can take a while for a long song: a message at the top says it is being made, with a bar for how far it has got, and when it is done, and the other WAV exports wait until it is.</li>
            <li><strong>MIDI:</strong> choose a controller, channel, target lane and live/record/step mode. With more than one controller connected, each can be sent somewhere of its own under Devices: a lane, the drums, or nowhere. Under Pads, press Learn beside a drum and hit a pad on the controller to make that pad play it; Reset pads puts the usual notes back. Under Controller knobs, choose a parameter, press Learn and turn a knob to tie the two. A controller's pitch bend bends the lane its keys play by two semitones, and its mod wheel (CC 1) drives any route whose source is Mod wheel unless that wheel is tied to a knob; both are played live and are not saved, recorded or exported. All of this is kept in this browser, for every project. Imported samples are kept there too.</li>
            <li><strong>On a phone:</strong> the top row is one line: the tempo, Play, and Undo and Redo where they fit. The button with three lines at its end opens the rest of this row. On the bar along the bottom, a tap shows a unit; a lane's lamp, and the drums', lights as it plays. Hold a lane's switch or the drums' to mute it without going to it: its name is then struck through.</li>
          </ul>
        </section>
        <section id="help-scenes" hidden={off('help-scenes')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-scenes')}>Scenes and song</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Scenes:</strong> a scene is one bar of everything: the notes on all three lanes and the drum grid. <strong>+ Copy</strong> adds one that starts the same as the open scene; <strong>+ Empty</strong> adds a blank one. Drag a scene along the row to put it in another place, or press Alt and an arrow key on it; on a touch screen, hold it first. Sounds, tempo and effects are shared by every scene.</li>
            <li><strong>Time:</strong> the open scene's time signature: 4/4, 3/4, 6/8, 5/4, 7/8 or 12/8. It sets how many steps a bar has on every lane and the drums (sixteen in 4/4, twelve in 3/4 and 6/8, twenty in 5/4, fourteen in 7/8, twenty-four in 12/8) and where the beats are marked and clicked. Each scene has its own, so a song can change from one to the next. A shorter bar cuts off the steps at its end and a longer one adds empty steps; Undo puts back what was cut. A MIDI file is read as 4/4.</li>
            <li><strong>Song:</strong> <strong>+ Add</strong> puts the open scene at the end of the song. Each block has − and + for how many times it repeats, arrows to move it, and ✕ to remove it. A block, or a row of the playlist, can also be dragged to another place.</li>
            <li><strong>Timeline and audio tracks:</strong> the third way of showing the song lays it along its bars, with audio tracks of recordings under it. <strong>Add Recording</strong> puts a sound file on the chosen track at the bar named beside it (or makes a track for it). Drag a clip along to move it, snapped to a beat (with Alt, a step), up or down to another track, or by an end to trim it; with the keyboard, the arrow keys move it and Delete takes it out. A clip's level, trim and fades are under the timeline once it is chosen. Clips play in Song mode and are in a Song WAV, not in a scene on its own, and their recordings stay in this browser and travel only in a saved project file.</li>
            <li><strong>Scene / Song:</strong> in Scene, Play loops the open scene. In Song, Play runs the song from the block you last clicked and the rack follows it. Tick Loop to start again at the end.</li>
          </ul>
        </section>
        <section id="help-lanes" hidden={off('help-lanes')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-lanes')}>Synth lanes</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Lane knobs:</strong> the four you reach for most, plus Level. Choosing a synth model swaps them for that model's own four.</li>
            <li><strong>Longer patterns:</strong> each lane's Notes tab and the drum strip have a Bars menu (1, 2, 4 or 8). A longer pattern is shown a bar at a time; pick the bar with the numbered buttons, or turn on Follow to watch the one that is playing. Lanes of different lengths loop against each other.</li>
            <li><strong>Moving a lane:</strong> press Alt and the up or down arrow on a lane's name to move it up or down the rack, or drag its strip in the mixer by its name. Only where it is shown changes: it keeps its number, its MIDI channel and its sound.</li>
            <li><strong>Lanes:</strong> a project starts with three synth lanes; Add Lane, after the third, adds a fourth and a fifth. Type a name in the field on a lane's top line to call it something other than Synth 1; clear it to give the number back.</li>
            <li><strong>Swing:</strong> the Swing button beside Bars swings that lane by the drums' Swing knob, so the bass and the beat share one groove. Whatever the drums' swing moves plays late with them; turn the drums' knob to set how much, or choose a swing template beside it. It is in audio exports, MIDI files and shared songs.</li>
            <li><strong>Recording:</strong> with Rec on in a lane's keyboard panel, a key played while the music runs is written where it was played, and lasts as long as the key was held, to the nearest step. Keys held together, or overlapping, are one Undo.</li>
            <li><strong>Notes and Sound:</strong> the open lane's editor has two levels. Notes is what the lane plays: the keyboard or piano roll, and each step's velocity, slide, chance, repeats, timing, strum and note length (in the piano roll, click several notes in one column for a chord, or choose a Chord shape and an Inversion and click its root, and drag a note's right edge to lengthen it; Strum starts each note of a chord a little after the one below it). Sound is what it sounds like: the model, the presets, and under them a page each for Osc, Filter, Amp, LFO, Arp, Inserts and Sends. Sound opens on the page it was last on, and at its top is a picture of the lane's sound as it plays, a <strong>Wave</strong> or a <strong>Spectrum</strong>, so a knob can be seen as well as heard. With Arp on, a key held on the keyboard or a MIDI controller is arpeggiated for as long as it is down, through every key held; Hold keeps it going after the keys come up. With the keyboard on either row of tabs, the arrow keys move along it.</li>
            <li><strong>Inserts:</strong> effects that belong to one lane and that no other lane hears: drive, a tone control (dark to the left, thin to the right), a chorus and a delay, in that order, before the lane's level reaches the mixer. The chorus and the delay can follow the tempo. They start at nothing, so a sound without them is just as it was. The Polysix model's Ensemble knob is the mix of its chorus.</li>
            <li><strong>Thicker and punchier:</strong> Unison (Osc tab) stacks detuned copies of each note. The filter has a 12 dB and a steeper 24 dB slope. Duck (Sends tab) dips the lane on every kick so the kick cuts through.</li>
            <li><strong>Automation:</strong> the row under the open lane's steps shows how one of its knobs moves through the pattern, its effect sends among them. Choose the knob from its menu (up to eight per lane), then draw across the bars with the pointer or a finger, or use the arrow keys on a bar (Delete empties a step). A step with no bar plays the knob as it is set; a step with a bar plays that value until the next step, with no slide between. Erase rubs out what you draw across, and Clear takes that knob's automation away. With Auto on, turning one of the lane's knobs while the song plays writes it into the pattern, step by step, and leaves the knob's own setting alone; Stop ends the pass, and one Undo takes the whole pass back. A knob that is automated has a small lamp at its shoulder. Automation belongs to the scene, like the notes, and is in audio exports and shared songs; MIDI files leave it out.</li>
            <li><strong>Recorded instruments:</strong> with the engine set to Sample (Osc tab), the Sample menu's Built in group has two grand pianos, a pipe organ, a tenor sax and three FM keyboards, each recorded every octave or so. These are fetched the first time one is used, so the first note can take a moment; offline, before one has been fetched, the lane plays its oscillator instead.</li>
            <li><strong>Your own instrument:</strong> the same menu takes <strong>several recordings</strong> of one instrument, each file a different note. The note each one is comes from its file's name (Piano C4.wav is C4) and can be changed before anything is kept; every note then plays the recording nearest it. A SoundFont file gives the same from one file.</li>
            <li><strong>Presets:</strong> save, load and delete sounds without touching the pattern.</li>
          </ul>
        </section>
        <section id="help-drums" hidden={off('help-drums')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-drums')}>Drums</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Swing templates:</strong> the menu beside the Swing knob sets the swing as drum machines count it: how far the late note falls between its neighbours, from 54% to 75%, and Triplet. <strong>16ths</strong> swing every second sixteenth; <strong>8ths</strong> swing the second eighth of each beat, for a shuffle. Turning the knob afterwards keeps the 16ths or 8ths and shows the amount as your own.</li>
            <li><strong>Spread:</strong> beside Fill, it puts so many hits along the selected drum's bar as evenly as the bar allows (a Euclidean rhythm: 3 in 8 is the tresillo), in place of what was on that bar. Shift then turns it to start elsewhere. One Undo takes it back.</li>
            <li><strong>Step details:</strong> each hit has a velocity, a chance of playing, and a repeat count that packs 2 to 4 hits into the step. Shift+click a hit to step through velocities.</li>
            <li><strong>More / Sends:</strong> More shows the humanize and pan knobs. Sends shows the kit's effect sends, and before them the selected drum's own two, <strong>Delay</strong> and <strong>Reverb</strong>.</li>
            <li><strong>A drum's own sends:</strong> each is that drum's share of what the kit sends to the delay or the reverb, so the kit's Dly Send and Rev Send are the master over all eight drums. Every drum starts at 100%, sent like the rest of the kit. Turn one down to keep that drum out: a dry kick under a snare with reverb on it. Drive, phaser and chorus are sent for the whole kit only. Choosing another kit leaves these where they are; Reset puts them back.</li>
            <li><strong>The Recorded kit:</strong> a kit in the kit menu in which every drum is a recording of a real one, and so is the cymbal. Tune plays a recording faster or slower, <strong>Decay</strong> (the drum's last knob) shortens its ring, and Tone darkens it below the middle. Left at the top and the middle they leave the recording as it is. The recordings come with the app; until they arrive the drums play their synthesized sounds.</li>
            <li><strong>Other percussion:</strong> some lanes have a <strong>Voice</strong> menu in the drum strip, in any kit: the Clap lane can be a tambourine, a shaker or a cowbell, the Snare a cross-stick, the Low Tom a conga and the High Tom a bongo. Each is a recording of a real one. Tune, Decay and Tone work on it as on the Recorded kit, and Reset puts the lane back.</li>
            <li><strong>Your own sounds:</strong> <strong>Sound</strong> puts an imported sample on the selected lane. <strong>Import Kit</strong> takes several files at once and matches each to a lane by its name, such as “Kick” or “HH Open”; check the matches before using them. <strong>SoundFont Kit</strong> takes a SoundFont (.sf2) drum kit: choose the kit if the file has several, and each lane is offered the drum General MIDI has for it (the kick on C2, the snare on D2 and so on), to check before using them. Samples stay in this browser.</li>
          </ul>
        </section>
        <section id="help-mixer" hidden={off('help-mixer')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-mixer')}>Mixer</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Every level in one place:</strong> a strip for each synth lane, each guest instrument, each drum and the whole kit, the two effect returns, the returns of aux buses A and B, and the main volume.</li>
            <li><strong>The same controls:</strong> a fader here and the knob in its own unit are one setting. Move either and the other follows, and Undo takes back a move made in either place. The mixer adds nothing to the project.</li>
            <li><strong>A strip:</strong> Pan, then the fader, then <strong>M</strong> to mute and <strong>S</strong> to solo. Drag a fader, turn the scroll wheel over it, step it with the arrow keys or type a figure under it; a middle click puts it back where it started, and a tap with a finger opens a large slider.</li>
            <li><strong>Whose level it is:</strong> a lane's and a drum's level are the project's, the same in every scene. A guest's level and mute are kept with each scene. The main volume is this browser's: it is not saved with the project, shared or exported.</li>
            <li><strong>Order:</strong> a synth lane's strip can be dragged by its name to another lane's place, which moves that lane on the rack as well.</li>
            <li><strong>Hide:</strong> folds the strips away. This browser remembers it.</li>
            <li><strong>Picture:</strong> beside the main volume, the whole mix as it leaves, drawn as a <strong>Wave</strong> or a <strong>Spectrum</strong> (how loud each pitch is, low on the left). It is a picture, not a meter: it shows the shape of the sound, not a level to mix by.</li>
          </ul>
        </section>
        <section id="help-effects" hidden={off('help-effects')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-effects')}>Effects</h3>
          <ul className="help-list help-list-plain">
            <li><strong>One set for the whole rack:</strong> Drive, Phaser, Delay, Chorus and Reverb are shared. Each has its own switch, and <strong>Enabled</strong> at the top switches the five of them on and off together.</li>
            <li><strong>Sends:</strong> an effect is heard only on what is sent to it. A lane's sends are on its Sends tab, the kit's are under <strong>Sends</strong> in the drum strip, where each drum also has a share of its own of the delay and the reverb, and a guest instrument has a Sends button of its own.</li>
            <li><strong>Aux A and Aux B:</strong> two more buses, each pointed at an echo, the Hall or a chorus from its block in the effects unit, with a Level for how loud it comes back. Every lane, the drum kit and every guest has an Aux A and an Aux B send, which start at nothing, so a project without them sounds as it did. The echo and the chorus can follow the tempo.</li>
            <li><strong>Returns:</strong> Synth Return and Drum Return set how much of the effects comes back into the mix, for the lanes and for the kit.</li>
            <li><strong>Two reverbs:</strong> the reverb's <strong>Kind</strong> menu chooses <strong>Room</strong>, close and a little grainy, which every project had before there was a choice, or <strong>Hall</strong>, a smoother, denser tail. Decay, Pre, Damp and Mix work the same on both; Decay is how long the Hall takes to die away.</li>
            <li><strong>In time:</strong> the Phaser, the Delay and the Chorus each have a Sync menu that sets them to a note value, so they follow the tempo. Turning the rate or time knob sets a free value again.</li>
            <li><strong>Master EQ:</strong> Low, Mid and High shape the whole mix, including sound that is sent to no effect. It has a switch of its own, and works whether or not the effects are enabled.</li>
          </ul>
        </section>
        <section id="help-guests" hidden={off('help-guests')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-guests')}>Guest instruments</h3>
          <ul className="help-list help-list-plain">
            <li><strong>What one is:</strong> another creator's web instrument, shown as a unit of its own in the rack. It follows the tempo and the play button, and its sound goes through the mixer. Add one with <strong>Add Guest Instrument</strong> in the Project menu, by the address of its page.</li>
            <li><strong>Another site:</strong> a guest is that site's page, so the browser contacts that site while the project is open, and the guest needs a connection to it. The page cannot read your projects or your account. A guest that arrives in a project someone shared asks before it is loaded.</li>
            <li><strong>Its controls:</strong> M mutes it and Level sets how loud it is. <strong>Sends</strong> shows its sends to the shared effects, <strong>Hide</strong> folds its page away, <strong>Reload</strong> loads the page again and <strong>Remove</strong> takes it out of the project.</li>
            <li><strong>Per scene:</strong> its settings, its level and its mute are kept with each scene, like a lane's notes.</li>
            <li><strong>Exports:</strong> a guest cannot be made into a file directly, so an audio export first plays the music through to record it. Guests are not in a MIDI export.</li>
            <li><strong>Giving a guest one of your voices:</strong> some guests, effects pads among them, can take a synth lane, the whole drum kit or one drum and play it through themselves. You choose which inside the guest. The voice then leaves the mix and its sends and is heard through the guest, and its strip on the mixer, its name plate and, for a drum, its name in the grid say where it has gone (→ and the guest's name). Muting it here still silences it. To keep it on the beat Discobot plays it a little early, so notes you play live on that voice come back a little late, and an edit near the playhead is heard a moment later than usual. An export records it through the guest and leaves it out of Discobot's own sound, so it is heard once.</li>
          </ul>
        </section>
        <section id="help-keys" hidden={off('help-keys')}>
          <h3 tabIndex={-1} onKeyDown={(event) => back(event, 'help-keys')}>Keys</h3>
          <ul className="help-list help-list-plain">
            <li><strong>Play notes from the computer keyboard:</strong> the A S D F G H J K L row is the white keys and W E T Y U O P the black keys, on the open lane. Z and X shift the octave.</li>
            <li><strong>Move along the steps:</strong> with a step selected, the left and right arrow keys select the one before or after it.</li>
            <li><strong>Without a mouse:</strong> Tab stops once on a row of steps, on the drum grid, on the piano roll and on the on-screen keys. From there the arrow keys move from one to the next, Home and End go to the ends, and Space or Enter presses the one you are on. On the on-screen keys, up and down always move a key at a time; left and right do too, unless a step is selected.</li>
            <li><strong>Play and stop:</strong> Space, as the Play All button does. When a button has the keyboard, Space presses that button instead; in a text field it types a space.</li>
            <li><strong>Every shortcut:</strong> Shift + ? shows them all in one list, with a search; so does Keyboard Shortcuts at the top of Help.</li>
            <li><strong>Tap tempo:</strong> Shift + T</li>
            <li><strong>Undo:</strong> Ctrl/Cmd + Z. <strong>Redo:</strong> Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y. They step back through note, sound, drum, tempo and effects edits in the order you made them.</li>
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
