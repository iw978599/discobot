import { useEffect, useRef, useState } from 'react';
import { useNarrow } from '../hooks/useNarrow';
import SaveState from './SaveState';
import { spaceBelongsToTarget } from '../hooks/useComputerKeyboard';
import type { Studio } from '../studio/useStudio';
import Knob from '../components/Knob';
import Menu from './Menu';
import Dialog from './Dialog';
import ExportDialog from './ExportDialog';
import { TapButton, TempoDisplay, useTapTempo } from './HeaderParts';
import { accountsEnabled } from '../services/account';
import { useAccountUser } from './AccountDialog';
import { enterKidsMode } from '../services/kids';
import { CLICK_LEVEL, COUNT_IN_CHOICES, clickLevel, countInBars } from '../services/metronome';

interface TransportUnitProps {
  studio: Studio;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
  onShare: () => void;
  onOpenAccount: () => void;
  onAddGuest: () => void;
  onOpenVersions: () => void;
}

// The top rack unit: tempo, transport, save and load, and the two menus that hold
// everything you do once per session instead of once per bar. A narrow screen has room for one
// line of it, the tempo, Play and (where they fit) Undo and Redo; the rest is in a sheet that
// the last button on that line raises from the bottom edge.
export default function TransportUnit({ studio, onOpenSettings, onOpenProjects, onShare, onOpenAccount, onAddGuest, onOpenVersions }: TransportUnitProps) {
  const { midiState } = studio;
  const [exporting, setExporting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const user = useAccountUser();
  const narrow = useNarrow();
  const tapTempo = useTapTempo((bpm) => { void studio.handleTempoChange(bpm); });
  // Space plays and stops, unless it belongs to whatever has the keyboard: a button or link it
  // would press, a field it types in, a menu, or a dialog.
  const playStop = useRef(studio.handleGlobalPlayStop);
  playStop.current = studio.handleGlobalPlayStop;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (spaceBelongsToTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      void playStop.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if (!narrow) setMoreOpen(false);
  }, [narrow]);
  // Something chosen in the sheet that opens a dialog, or leaves the page, puts the sheet away
  // first. The sheet hands focus back to its button as it goes, so the dialog that opens in the
  // same turn returns focus there when it closes. On a wide screen there is no sheet to put away.
  const leaving = (action: () => void) => () => { setMoreOpen(false); action(); };
  const midiStatus = !midiState.supported ? 'MIDI is not available in this browser'
    : midiState.connected ? 'A MIDI controller is connected' : 'No MIDI controller connected';

  const projectName = (
    <button className="project-name" onClick={leaving(onOpenProjects)} aria-label={`Project: ${studio.projectName}`} title="See all projects, rename this one, or keep a copy">
      {studio.projectName || 'Untitled'}
    </button>
  );
  const tempo = (
    <TempoDisplay tempo={studio.globalTempo} onChange={(bpm) => { void studio.handleTempoChange(bpm); }} flash={tapTempo.flash} onTap={narrow ? undefined : tapTempo.tap} />
  );
  const metronome = (
    <div className="metronome-switches" role="group" aria-label="Metronome">
      <button
        className={`rack-btn ${studio.metronome.click ? 'on' : ''}`}
        aria-pressed={studio.metronome.click}
        title="Metronome: a click on every beat while playing. It is not in an export"
        onClick={() => studio.handleMetronomeChange({ click: !studio.metronome.click })}
      >
        Click
      </button>
      <button
        className={`rack-btn ${studio.metronome.countIn ? 'on' : ''}`}
        aria-pressed={studio.metronome.countIn}
        title="Count-in: bars of clicks before playing starts"
        onClick={() => studio.handleMetronomeChange({ countIn: !studio.metronome.countIn })}
      >
        Count
      </button>
      <select
        className="count-in-bars"
        aria-label="Count-in length"
        title="How many bars the count-in lasts"
        value={countInBars(studio.metronome)}
        onChange={(event) => studio.handleMetronomeChange({ bars: Number(event.target.value) })}
      >
        {COUNT_IN_CHOICES.map(bars => <option key={bars} value={bars}>{bars} {bars === 1 ? 'bar' : 'bars'}</option>)}
      </select>
      <Knob
        size="small"
        label="Click level"
        value={clickLevel(studio.metronome)}
        defaultValue={CLICK_LEVEL}
        displayValue={`${Math.round(clickLevel(studio.metronome) * 100)}%`}
        parseInputValue={(input) => { const value = Number.parseFloat(input); return Number.isFinite(value) ? value / 100 : null; }}
        onChange={(level) => studio.handleMetronomeChange({ level })}
        color="#f1f1ee"
        tooltip="How loud the click and the count-in are, in this browser"
      />
    </div>
  );
  const play = (
    <button className={`rack-btn go play-all-button ${studio.isAnyPlaying ? 'playing' : ''}`} onClick={() => { void studio.handleGlobalPlayStop(); }} title={`${studio.isAnyPlaying ? 'Stop' : 'Start'} every lane and the drums (Space)`}>
      {studio.isAnyPlaying ? '⏹ Stop All' : '▶ Play All'}
    </button>
  );
  const undo = <button className="rack-btn" onClick={() => { void studio.handleUndo(); }} title="Undo (Ctrl/Cmd+Z)">Undo</button>;
  const redo = <button className="rack-btn" onClick={() => { void studio.handleRedo(); }} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>;
  const projectMenu = (
    <Menu
      label="Project"
      groups={[[
        { label: 'New Project', title: 'Start an empty project. The open one stays in your projects', onSelect: leaving(() => { void studio.handleNewProject(); }) },
        { label: 'All Projects', title: 'Open, rename, copy or delete projects', onSelect: leaving(onOpenProjects) },
        { label: 'Save a Copy', title: 'Keep a copy of this project as it is now, to go back to', onSelect: leaving(() => { void studio.handleCopyProject(studio.projectId); }) },
        { label: 'Version History', title: 'Go back to an earlier version of this project', onSelect: leaving(onOpenVersions) },
      ], [
        { label: 'Share Link', title: 'Make a link that plays this song for anyone who opens it', onSelect: leaving(onShare) },
        { label: 'Export Project', title: 'Download the whole project as a file', onSelect: leaving(studio.handleExportProject) },
        { label: 'Import Project', title: 'Add a project file to your projects and open it', onSelect: leaving(() => studio.projectImportFileRef.current?.click()) },
        { label: 'Import MIDI', title: 'Bring notes in from a .mid file', onSelect: leaving(studio.handleMidiImportClick) },
      ], [
        { label: 'Add Guest Instrument', title: "Host another creator's web instrument in this project, by its address", onSelect: leaving(onAddGuest) },
        { label: 'Kids Mode', title: 'Big pads, a beat grid of pictures and one play button for a small child. It keeps its own tune and cannot change your projects', onSelect: leaving(enterKidsMode) },
      ], [
        { label: 'Reset All', title: 'Clear every lane, the drums and the effects of this project', danger: true, onSelect: leaving(() => { void studio.handleReset(); }) },
      ]]}
    />
  );
  const exportButton = (
    <button className="rack-btn" aria-haspopup="dialog" title="Save the scene or the whole song as audio or MIDI" onClick={leaving(() => setExporting(true))}>Export</button>
  );
  const accountHint = user ? 'Your account' : 'Sign in or create an account. Optional';
  const account = accountsEnabled && (
    <button className="rack-btn account-button" onClick={leaving(onOpenAccount)} title={accountHint} aria-label={user ? `Account: ${user.username}` : 'Sign in'}>
      {user ? user.username : 'Sign In'}
    </button>
  );
  const midi = (
    <button className="rack-btn" onClick={leaving(onOpenSettings)} title={midiStatus} aria-label="MIDI and samples">
      <span className={`rack-led ${midiState.connected ? 'on' : ''}`} /> MIDI
    </button>
  );
  const help = <button className="rack-btn" onClick={leaving(() => studio.setHelpOpen(true))} title="How to use Discobot" aria-label="Help">?</button>;
  const mute = (
    <button
      className={`rack-btn mute-button ${studio.browserMuted ? 'on' : ''}`}
      aria-pressed={studio.browserMuted}
      onClick={() => studio.setBrowserMuted(muted => !muted)}
      title={studio.browserMuted ? 'Unmute all sound' : 'Mute all sound'}
    >
      Mute
    </button>
  );
  const volume = (
    <Knob
      size="small"
      label="Volume"
      value={studio.browserVolume}
      defaultValue={1}
      displayValue={`${Math.round(studio.browserVolume * 100)}%`}
      parseInputValue={(input) => { const value = Number.parseFloat(input); return Number.isFinite(value) ? value / 100 : null; }}
      onChange={studio.setBrowserVolume}
      color="#f1f1ee"
      tooltip="Output volume for this browser tab"
    />
  );
  const files = (
    <>
      <input
        ref={studio.projectImportFileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Import project file"
        hidden
        onChange={(event) => { void studio.handleImportProjectFile(event); }}
      />
      <input ref={studio.midiImportFileRef} type="file" accept=".mid,.midi" hidden onChange={(event) => { void studio.handleMidiImportFile(event); }} />
    </>
  );

  if (narrow) {
    return (
      <header className="rack-unit transport">
        <div className="rack-row">
          <h1 className="sr-only">Discobot</h1>
          {tempo}
          {play}
          {/* Drawn, not written: the bar has no room for the words, and a phone's faces do not all have the arrows. */}
          <button className="rack-btn bar-icon bar-history" onClick={() => { void studio.handleUndo(); }} aria-label="Undo" title="Undo">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h8.5a4.5 4.5 0 0 1 0 9H8" /></svg>
          </button>
          <button className="rack-btn bar-icon bar-history" onClick={() => { void studio.handleRedo(); }} aria-label="Redo" title="Redo">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 4 4 4-4 4M17 8H8.5a4.5 4.5 0 0 0 0 9H12" /></svg>
          </button>
          <button className="rack-btn bar-icon more-button" aria-haspopup="dialog" aria-expanded={moreOpen} aria-label="More controls" title="Project, Export, the metronome, volume, MIDI and Help" onClick={() => setMoreOpen(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
          </button>
          {moreOpen && (
            <Dialog title="More controls" closeLabel="Close more controls" onClose={() => setMoreOpen(false)} sheet>
              <div className="more-project">
                {projectName}
                <SaveState projectId={studio.projectId} full />
              </div>
              <div className="more-group more-history">
                {undo}
                {redo}
              </div>
              <div className="more-group">
                <TapButton onTap={tapTempo.tap} />
                {metronome}
                <span className="more-gap" />
                {mute}
                {volume}
              </div>
              <div className="more-rows">
                <div className="more-row">{projectMenu}<span>Projects, copies, earlier versions, share links, files and Kids Mode</span></div>
                <div className="more-row">{exportButton}<span>Save the scene or the whole song as audio or MIDI</span></div>
                {account && <div className="more-row">{account}<span>{accountHint}</span></div>}
                <div className="more-row">{midi}<span>{midiStatus}. Imported samples are kept here too</span></div>
                <div className="more-row">{help}<span>How to use Discobot, and the walkthrough</span></div>
              </div>
              <p className="more-hint">To mute a synth lane or the drums without going to it, hold its switch on the bar along the bottom.</p>
            </Dialog>
          )}
          {exporting && <ExportDialog studio={studio} onClose={() => setExporting(false)} />}
        </div>
        {files}
      </header>
    );
  }

  return (
    <header className="rack-unit transport">
      <div className="rack-row">
        <div className="rack-plate static brand">
          <h1>Discobot</h1>
          <div className="project-line">
            {projectName}
            <SaveState projectId={studio.projectId} />
          </div>
        </div>
        {tempo}
        {metronome}
        {play}
        <div className="rack-grow" />
        {undo}
        {redo}
        {projectMenu}
        {exportButton}
        {exporting && <ExportDialog studio={studio} onClose={() => setExporting(false)} />}
        {account}
        {midi}
        {help}
        {mute}
        {volume}
      </div>
      {files}
    </header>
  );
}
