import type { Studio } from '../studio/useStudio';
import { downloadArrangementWav, downloadStemsZip } from '../services/wavExport';
import Knob from '../components/Knob';
import Menu from './Menu';
import { TempoDisplay } from './HeaderParts';

interface TransportUnitProps {
  studio: Studio;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
  onShare: () => void;
}

// The top rack unit: tempo, transport, save and load, and the two menus that hold
// everything you do once per session instead of once per bar.
export default function TransportUnit({ studio, onOpenSettings, onOpenProjects, onShare }: TransportUnitProps) {
  const { midiState } = studio;
  const midiStatus = !midiState.supported ? 'MIDI is not available in this browser'
    : midiState.connected ? 'A MIDI controller is connected' : 'No MIDI controller connected';
  return (
    <header className="rack-unit transport">
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
            { label: 'Share Link', title: 'Make a link that plays this song for anyone who opens it', onSelect: onShare },
            { label: 'Export Project', title: 'Download the whole project as a file', onSelect: studio.handleExportProject },
            { label: 'Import Project', title: 'Add a project file to your projects and open it', onSelect: () => studio.projectImportFileRef.current?.click() },
            { label: 'Import MIDI', title: 'Bring notes in from a .mid file', onSelect: studio.handleMidiImportClick },
            { label: 'Reset All', title: 'Clear every lane, the drums and the effects of this project', onSelect: () => { void studio.handleReset(); } },
          ]}
        />
        <Menu
          label="Export"
          items={[
            { label: 'Download WAV', title: 'The open scene: one bar with its effect tail', onSelect: () => { void downloadArrangementWav(studio.currentArrangement()).catch(studio.reportExportError); } },
            { label: 'Loop WAV', title: 'One bar that loops seamlessly, with effect tails wrapped in', onSelect: () => { void downloadArrangementWav(studio.currentArrangement(), { loop: true }).catch(studio.reportExportError); } },
            { label: 'Stems', title: 'Each synth lane and the drums as separate WAV files in a zip', onSelect: () => { void downloadStemsZip(studio.currentArrangement()).catch(studio.reportExportError); } },
            { label: 'Export MIDI', title: 'A Standard MIDI File of the open scene', onSelect: studio.handleExportMidi },
            { label: 'Song WAV', title: 'The whole song, start to finish, as one audio file', onSelect: () => { void studio.songArrangement().then(song => downloadArrangementWav(song)).catch(studio.reportExportError); } },
            { label: 'Song MIDI', title: 'The whole song as a MIDI file, with a marker at each section', onSelect: () => { void studio.handleExportSongMidi().catch(studio.reportExportError); } },
          ]}
        />
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
