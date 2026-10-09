import { useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { playSample } from '../hooks/browserAudio';
import EffectsPanel from '../components/EffectsPanel';
import MidiPanel from '../components/MidiPanel';
import SamplePanel from '../components/SamplePanel';
import TransportUnit from './TransportUnit';
import SynthModule from './SynthModule';
import DrumModule from './DrumModule';
import Dialog from './Dialog';
import PatternManager from './PatternManager';
import MidiImportDialog from './MidiImportDialog';
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
  const [managerOpen, setManagerOpen] = useState(false);
  const { midiState } = studio;

  return (
    <div className="rack-page">
      <div className="rack">
        <TransportUnit
          studio={studio}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenManager={() => { void studio.refreshSavedPatterns(); setManagerOpen(true); }}
        />
        {studio.storageError && (
          <div role="alert" className="app-alert">
            <span>{studio.storageError}</span>
            <button className="rack-btn" onClick={() => studio.setStorageError(null)} aria-label="Dismiss message">✕</button>
          </div>
        )}
        {[1, 2, 3].map(id => <SynthModule key={id} studio={studio} synthId={id} />)}
        <DrumModule studio={studio} />
        <div className="rack-unit effects-unit">
          <EffectsPanel effectsLoop={studio.effectsLoop} onChange={studio.handleEffectsLoopChange} />
        </div>
      </div>

      <HelpModal open={studio.helpOpen} onClose={() => studio.setHelpOpen(false)} />
      <MidiImportDialog studio={studio} />
      {managerOpen && (
        <PatternManager
          saved={studio.savedPatterns}
          onLoad={(id) => { void studio.handleLoadGlobal(id); }}
          onChanged={() => { void studio.refreshSavedPatterns(); }}
          onClose={() => setManagerOpen(false)}
        />
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
