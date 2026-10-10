import { useEffect, useRef } from 'react';
import type { Studio } from '../studio/useStudio';
import Knob from '../components/Knob';
import Menu from './Menu';
import { TempoDisplay } from './HeaderParts';
import { accountsEnabled } from '../services/account';
import { useAccountUser } from './AccountDialog';

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
// everything you do once per session instead of once per bar.
export default function TransportUnit({ studio, onOpenSettings, onOpenProjects, onShare, onOpenAccount, onAddGuest, onOpenVersions }: TransportUnitProps) {
  const { midiState } = studio;
  const user = useAccountUser();
  const midiStatus = !midiState.supported ? 'MIDI is not available in this browser'
    : midiState.connected ? 'A MIDI controller is connected' : 'No MIDI controller connected';
  // On a narrow screen the bar wraps over several lines and only the last, with the tempo and
  // Play, stays stuck to the top (rack.css). This tells the stylesheet how tall the others are.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current, play = bar?.querySelector<HTMLElement>('.play-all-button');
    if (!bar || !play || typeof ResizeObserver === 'undefined') return;
    const measure = () => bar.style.setProperty('--transport-tuck', `${Math.max(0, play.offsetTop - 8)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <header ref={barRef} className="rack-unit transport">
      <div className="rack-row">
        <div className="rack-plate static brand">
          <h1>Discobot</h1>
          <button className="project-name" onClick={onOpenProjects} aria-label={`Project: ${studio.projectName}`} title="See all projects, rename this one, or keep a copy">
            {studio.projectName || 'Untitled'}
          </button>
        </div>
        <TempoDisplay tempo={studio.globalTempo} onChange={(bpm) => { void studio.handleTempoChange(bpm); }} />
        <button className={`rack-btn go play-all-button ${studio.isAnyPlaying ? 'playing' : ''}`} onClick={() => { void studio.handleGlobalPlayStop(); }}>
          {studio.isAnyPlaying ? '⏹ Stop All' : '▶ Play All'}
        </button>
        <div className="rack-grow" />
        <button className="rack-btn" onClick={() => { void studio.handleUndo(); }} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button className="rack-btn" onClick={() => { void studio.handleRedo(); }} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        <Menu
          label="Project"
          items={[
            { label: 'New Project', title: 'Start an empty project. The open one stays in your projects', onSelect: () => { void studio.handleNewProject(); } },
            { label: 'All Projects', title: 'Open, rename, copy or delete projects', onSelect: onOpenProjects },
            { label: 'Save a Copy', title: 'Keep a copy of this project as it is now, to go back to', onSelect: () => { void studio.handleCopyProject(studio.projectId); } },
            { label: 'Version History', title: 'Go back to an earlier version of this project', onSelect: onOpenVersions },
            { label: 'Share Link', title: 'Make a link that plays this song for anyone who opens it', onSelect: onShare },
            { label: 'Export Project', title: 'Download the whole project as a file', onSelect: studio.handleExportProject },
            { label: 'Import Project', title: 'Add a project file to your projects and open it', onSelect: () => studio.projectImportFileRef.current?.click() },
            { label: 'Add Guest Instrument', title: "Host another creator's web instrument in this project, by its address", onSelect: onAddGuest },
            { label: 'Import MIDI', title: 'Bring notes in from a .mid file', onSelect: studio.handleMidiImportClick },
            { label: 'Reset All', title: 'Clear every lane, the drums and the effects of this project', onSelect: () => { void studio.handleReset(); } },
          ]}
        />
        <Menu
          label="Export"
          items={[
            { label: 'Download WAV', title: 'The open scene: one bar with its effect tail', onSelect: () => { void studio.handleExportWav('pattern').catch(studio.reportExportError); } },
            { label: 'Loop WAV', title: 'One bar that loops seamlessly, with effect tails wrapped in', onSelect: () => { void studio.handleExportWav('loop').catch(studio.reportExportError); } },
            { label: 'Stems', title: 'Each synth lane, the drums and each guest instrument as separate WAV files in a zip', onSelect: () => { void studio.handleExportWav('stems').catch(studio.reportExportError); } },
            { label: 'Export MIDI', title: 'A Standard MIDI File of the open scene', onSelect: studio.handleExportMidi },
            { label: 'Song WAV', title: 'The whole song, start to finish, as one audio file', onSelect: () => { void studio.handleExportWav('song').catch(studio.reportExportError); } },
            { label: 'Song MIDI', title: 'The whole song as a MIDI file, with a marker at each section', onSelect: () => { void studio.handleExportSongMidi().catch(studio.reportExportError); } },
          ]}
        />
        {accountsEnabled && (
          <button className="rack-btn account-button" onClick={onOpenAccount} title={user ? 'Your account' : 'Sign in or create an account. Optional'} aria-label={user ? `Account: ${user.username}` : 'Sign in'}>
            {user ? user.username : 'Sign In'}
          </button>
        )}
        <button className="rack-btn" onClick={onOpenSettings} title={midiStatus} aria-label="MIDI and samples">
          <span className={`rack-led ${midiState.connected ? 'on' : ''}`} /> MIDI
        </button>
        <button className="rack-btn" onClick={() => studio.setHelpOpen(true)} title="How to use Discobot" aria-label="Help">?</button>
        <button
          className={`rack-btn mute-button ${studio.browserMuted ? 'on' : ''}`}
          aria-pressed={studio.browserMuted}
          onClick={() => studio.setBrowserMuted(muted => !muted)}
          title={studio.browserMuted ? 'Unmute all sound' : 'Mute all sound'}
        >
          Mute
        </button>
        <Knob
          size="small"
          label="Volume"
          value={studio.browserVolume}
          displayValue={`${Math.round(studio.browserVolume * 100)}%`}
          parseInputValue={(input) => { const value = Number.parseFloat(input); return Number.isFinite(value) ? value / 100 : null; }}
          onChange={studio.setBrowserVolume}
          color="#f1f1ee"
          tooltip="Output volume for this browser tab"
        />
      </div>
      <input
        ref={studio.projectImportFileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Import project file"
        hidden
        onChange={(event) => { void studio.handleImportProjectFile(event); }}
      />
      <input ref={studio.midiImportFileRef} type="file" accept=".mid,.midi" hidden onChange={(event) => { void studio.handleMidiImportFile(event); }} />
    </header>
  );
}
