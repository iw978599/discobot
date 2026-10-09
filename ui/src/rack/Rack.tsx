import { useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { playSample } from '../hooks/browserAudio';
import EffectsPanel from '../components/EffectsPanel';
import MidiPanel from '../components/MidiPanel';
import SamplePanel from '../components/SamplePanel';
import TransportUnit from './TransportUnit';
import SynthModule from './SynthModule';
import DrumModule from './DrumModule';
import SongModule from './SongModule';
import Dialog from './Dialog';
import ProjectsDialog from './ProjectsDialog';
import ShareDialog from './ShareDialog';
import AccountDialog, { useSyncStatus } from './AccountDialog';
import { projectSync } from '../services/projectSync';
import MidiImportDialog from './MidiImportDialog';
import GuestModule from './GuestModule';
import AddGuestDialog from './AddGuestDialog';
import VersionsDialog from './VersionsDialog';
import { HelpModal } from './HeaderParts';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './rack.css';

// The whole instrument as one rack, read top to bottom: transport, three synth lanes,
// the drum grid, then the shared effects.
export default function Rack({ studio }: { studio: Studio }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const { midiState } = studio;
  const sync = useSyncStatus();

  return (
    <div className="rack-page">
      <div className="rack">
        <TransportUnit
          studio={studio}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProjects={() => setProjectsOpen(true)}
          onShare={() => setShareOpen(true)}
          onOpenAccount={() => setAccountOpen(true)}
          onAddGuest={() => setGuestOpen(true)}
          onOpenVersions={() => setVersionsOpen(true)}
        />
        {studio.changedElsewhere && (
          <div role="alert" className="app-alert">
            <span>This project was changed in another tab. Edits made here are not being saved.</span>
            <span className="app-alert-actions">
              <button className="rack-btn" onClick={studio.loadOtherTabVersion}>Load the other tab's version</button>
              <button className="rack-btn" onClick={studio.keepThisTabVersion}>Keep this tab's version</button>
            </span>
          </div>
        )}
        {sync.keptBoth.length > 0 && (
          <div role="alert" className="app-alert">
            <span>
              {sync.keptBoth.map(name => `“${name}”`).join(' and ')} {sync.keptBoth.length === 1 ? 'was' : 'were'} also changed in another browser.
              Both versions are kept: the one from this browser is named “… (this browser's version)”.
            </span>
            <button className="rack-btn" onClick={projectSync.dismissKeptBoth} aria-label="Dismiss sync message">✕</button>
          </div>
        )}
        {studio.guestRecording !== null && (
          <div role="status" className="app-alert">
            <span>
              Recording the guest instruments for the export. The music plays through once, about {Math.ceil(studio.guestRecording)} seconds, and then the file downloads.
            </span>
          </div>
        )}
        {studio.storageError && (
          <div role="alert" className="app-alert">
            <span>{studio.storageError}</span>
            <button className="rack-btn" onClick={() => studio.setStorageError(null)} aria-label="Dismiss message">✕</button>
          </div>
        )}
        <SongModule studio={studio} />
        {[1, 2, 3].map(id => <SynthModule key={id} studio={studio} synthId={id} />)}
        {studio.guests.map(guest => <GuestModule key={guest.id} studio={studio} guest={guest} />)}
        <DrumModule studio={studio} />
        <div className="rack-unit effects-unit">
          <EffectsPanel effectsLoop={studio.effectsLoop} onChange={studio.handleEffectsLoopChange} />
        </div>
      </div>

      <HelpModal open={studio.helpOpen} onClose={() => studio.setHelpOpen(false)} />
      <MidiImportDialog studio={studio} />
      {projectsOpen && <ProjectsDialog studio={studio} onClose={() => setProjectsOpen(false)} />}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
      {guestOpen && <AddGuestDialog studio={studio} onClose={() => setGuestOpen(false)} />}
      {versionsOpen && <VersionsDialog studio={studio} onClose={() => setVersionsOpen(false)} />}
      {studio.presetImportReport && (
        <Dialog title="Preset imported" closeLabel="Close import report" onClose={() => studio.setPresetImportReport(null)}>
          <p><strong>{studio.presetImportReport.name}</strong> was imported from {studio.presetImportReport.source}. It is on the lane now and saved with your presets.</p>
          {studio.presetImportReport.source !== 'Discobot' && (
            <p>Another synth's preset is translated, not copied: the two make sound differently, so expect to adjust it by ear.</p>
          )}
          {studio.presetImportReport.notes.length > 0 && (
            <>
              <h3>What did not carry over</h3>
              <ul className="import-notes">
                {studio.presetImportReport.notes.map(note => <li key={note}>{note}</li>)}
              </ul>
            </>
          )}
        </Dialog>
      )}
      {settingsOpen && (
        <Dialog title="MIDI and samples" closeLabel="Close MIDI and samples" onClose={() => setSettingsOpen(false)}>
          <h3>MIDI controller</h3>
          <MidiPanel
            supported={midiState.supported}
            connected={midiState.connected}
            devices={midiState.devices}
            allDevicesId={midiState.allDevicesId}
            selectedDeviceId={midiState.selectedDeviceId}
            onDeviceChange={midiState.setSelectedDeviceId}
            mode={studio.midiMode}
            onModeChange={studio.setMidiMode}
            channel={studio.midiChannel}
            onChannelChange={studio.setMidiChannel}
            synthIds={studio.synths.map(synth => synth.id)}
            targetSynthId={studio.midiTargetSynthId}
            onTargetSynthChange={studio.setMidiTargetSynthId}
            lastMessage={midiState.lastMessage}
            error={midiState.error}
          />
          <SamplePanel onPlay={sample => playSample(sample.data)} />
        </Dialog>
      )}
    </div>
  );
}
