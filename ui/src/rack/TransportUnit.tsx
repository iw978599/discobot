import type { Studio } from '../studio/useStudio';
import { downloadArrangementWav, downloadStemsZip } from '../services/wavExport';
import Knob from '../components/Knob';
import Menu from './Menu';
import { LoadPattern, SavePattern, TempoDisplay } from './HeaderParts';

interface TransportUnitProps {
  studio: Studio;
  onOpenSettings: () => void;
  onOpenManager: () => void;
}

// The top rack unit: tempo, transport, save and load, and the two menus that hold
// everything you do once per session instead of once per bar.
export default function TransportUnit({ studio, onOpenSettings, onOpenManager }: TransportUnitProps) {
  const { midiState } = studio;
  const midiStatus = !midiState.supported ? 'MIDI is not available in this browser'
    : midiState.connected ? 'A MIDI controller is connected' : 'No MIDI controller connected';
  return (
    <header className="rack-unit transport">
      <div className="rack-row">
        <div className="rack-plate static brand">
          <h1>Discobot</h1>
          <span className="active-pattern-name" title={studio.activeSavedPattern?.name}>
            {studio.activeSavedPattern?.name ?? 'Unsaved arrangement'}
          </span>
        </div>
        <TempoDisplay tempo={studio.globalTempo} onChange={(bpm) => { void studio.handleTempoChange(bpm); }} />
        <button className={`rack-btn go play-all-button ${studio.isAnyPlaying ? 'playing' : ''}`} onClick={() => { void studio.handleGlobalPlayStop(); }}>
          {studio.isAnyPlaying ? '⏹ Stop All' : '▶ Play All'}
        </button>
        <SavePattern
          saving={studio.saving}
          setSaving={studio.setSaving}
          saveName={studio.saveName}
          setSaveName={studio.setSaveName}
          savedFeedback={studio.savedFeedback}
          setSavedFeedback={studio.setSavedFeedback}
          onSave={studio.handleSaveGlobal}
        />
        <LoadPattern
          loading={studio.loadingSavedPatterns}
          savedPatterns={studio.savedPatterns}
          onLoad={(id) => { void studio.handleLoadGlobal(id); }}
          onRefresh={() => { void studio.refreshSavedPatterns(); }}
        />
        <div className="rack-grow" />
        <button className="rack-btn" onClick={() => { void studio.handleUndo(); }} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button className="rack-btn" onClick={() => { void studio.handleRedo(); }} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        <Menu
          label="Project"
          items={[
            { label: 'Export Project', title: 'Download the whole project as a file', onSelect: studio.handleExportProject },
            { label: 'Import Project', title: 'Open a project file, replacing the current project', onSelect: () => studio.projectImportFileRef.current?.click() },
            { label: 'Import MIDI', title: 'Bring notes in from a .mid file', onSelect: studio.handleMidiImportClick },
            { label: 'Manage Saved', title: 'Load or delete saved arrangements', onSelect: onOpenManager },
            { label: 'Reset All', title: 'Clear every lane, the drums and the effects', onSelect: () => { void studio.handleReset(); } },
          ]}
        />
        <Menu
          label="Export"
          items={[
            { label: 'Download WAV', title: 'One bar with its effect tail', onSelect: () => { void downloadArrangementWav(studio.currentArrangement()).catch(studio.reportExportError); } },
            { label: 'Loop WAV', title: 'One bar that loops seamlessly, with effect tails wrapped in', onSelect: () => { void downloadArrangementWav(studio.currentArrangement(), { loop: true }).catch(studio.reportExportError); } },
            { label: 'Stems', title: 'Each synth lane and the drums as separate WAV files in a zip', onSelect: () => { void downloadStemsZip(studio.currentArrangement()).catch(studio.reportExportError); } },
            { label: 'Export MIDI', title: 'A Standard MIDI File of the arrangement', onSelect: studio.handleExportMidi },
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
