import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { playSample } from '../hooks/browserAudio';
import EffectsPanel from '../components/EffectsPanel';
import MidiPanel from '../components/MidiPanel';
import SamplePanel from '../components/SamplePanel';
import TransportUnit from './TransportUnit';
import SynthModule from './SynthModule';
import DrumModule from './DrumModule';
import MixerModule from './MixerModule';
import { mixerChannels, sameMixer } from '../services/mixerChannels';
import SongModule from './SongModule';
import StarterUnit from './StarterUnit';
import Dialog from './Dialog';
import ProjectsDialog from './ProjectsDialog';
import ShareDialog from './ShareDialog';
import AccountDialog, { useAccountUser, useSyncStatus } from './AccountDialog';
import { projectSync } from '../services/projectSync';
import { markWalkthroughSeen } from '../services/walkthrough';
import Walkthrough from './Walkthrough';
import MidiImportDialog from './MidiImportDialog';
import GuestModule from './GuestModule';
import AddGuestDialog from './AddGuestDialog';
import VersionsDialog from './VersionsDialog';
import { HelpModal } from './HeaderParts';
import { useWakeLock } from '../hooks/useWakeLock';
import { useNarrow } from '../hooks/useNarrow';
import { laneUnit, storeRackUnit, storedRackUnit, unitLane, type RackUnit } from '../services/rackView';
import UnitBar from './UnitBar';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './rack.css';
import AddLaneUnit from './AddLaneUnit';
import { shownLanes } from '../services/lanes';

// The whole instrument as one rack, read top to bottom: transport, three synth lanes,
// the drum grid, the mixer, then the shared effects.
export default function Rack({ studio }: { studio: Studio }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // The section Help opens at when it was asked for from a unit's own "?". It is how Help was
  // reached, so it is kept here; whether Help is open is the studio's, and when that says it has
  // closed (by its button, Escape or the walkthrough) the section is forgotten.
  const [helpAt, setHelpAt] = useState<string | null>(null);
  const { helpOpen, setHelpOpen } = studio;
  const openHelpAt = useCallback((section: string) => {
    setHelpAt(section);
    setHelpOpen(true);
  }, [setHelpOpen]);
  useEffect(() => {
    if (!helpOpen) setHelpAt(null);
  }, [helpOpen]);
  // Where the walkthrough started from, to be put back when it ends: on a narrow screen it
  // turns to other units and opens other lanes as it goes.
  const tourFrom = useRef<{ unit: RackUnit; lane: number } | null>(null);
  const endTour = () => {
    setTourOpen(false);
    const from = tourFrom.current;
    tourFrom.current = null;
    if (!from || !narrow) return;
    setUnit(from.unit);
    if (studio.synths.some(synth => synth.id === from.lane)) studio.setSelectedSynthId(from.lane);
  };
  const startTour = () => {
    tourFrom.current = { unit, lane: studio.selectedSynthId };
    setAccountOpen(false);
    studio.setHelpOpen(false);
    markWalkthroughSeen();
    setTourOpen(true);
  };
  const { midiState } = studio;
  useWakeLock(studio.isAnyPlaying);
  const sync = useSyncStatus();
  const user = useAccountUser();

  // The mixer is handed the levels it shows, already gathered, and the same object for as long as
  // none of them changes: the lanes and the drums are new objects after every note and step.
  const { synths, drumState, drumMasterVolume, guests, effectsLoop, browserVolume } = studio;
  const levels = useMemo(
    () => mixerChannels({ synths, drumState, drumMasterVolume, guests, effectsLoop, browserVolume }),
    [synths, drumState, drumMasterVolume, guests, effectsLoop, browserVolume],
  );
  const mixer = useRef(levels);
  if (!sameMixer(mixer.current, levels)) mixer.current = levels;

  // A narrow screen shows one unit at a time. Which one is view state, kept here and handed to
  // the stylesheet as an attribute: the units themselves are not told, so none of them renders
  // again when another is shown, and a unit that is off screen is hidden, never taken away.
  const narrow = useNarrow();
  const pageRef = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState<RackUnit>(() => storedRackUnit() ?? laneUnit(studio.selectedSynthId));
  const hasGuests = studio.guests.length > 0;
  const shown = unit === 'guests' && !hasGuests ? laneUnit(studio.selectedSynthId) : unit;
  const paged = narrow && shown !== 'all';
  // Counts the times a unit was asked for from the bar, so the page can settle after each.
  const [moves, setMoves] = useState(0);
  const show = (next: RackUnit) => {
    const lane = unitLane(next);
    if (lane !== null && studio.synths.some(synth => synth.id === lane)) studio.setSelectedSynthId(lane);
    setUnit(next);
    storeRackUnit(next);
    setMoves(count => count + 1);
  };
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || moves === 0) return;
    // The new unit starts at its top, just under the transport.
    page.scrollTop = 0;
    // Focus goes into the unit that was asked for, so the next Tab is inside it and a screen
    // reader says where it is. The whole rack has no one place to go, and focus stays on the bar.
    if (shown === 'all') return;
    const target = page.querySelector<HTMLElement>(`.rack > [data-unit="${shown}"]`);
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [moves]);
  // The lane on show and the lane open for editing are kept the same one, whichever moves. The
  // editor, the keyboard and MIDI all belong to the open lane, so a lane on show that was not
  // open would be a row of steps with nothing to play it by.
  const openLane = studio.selectedSynthId;
  const lastOpenLane = useRef(openLane);
  const lanes = studio.synths.map(synth => synth.id).join();
  useEffect(() => {
    const moved = lastOpenLane.current !== openLane;
    lastOpenLane.current = openLane;
    const lane = unitLane(unit);
    if (!narrow || lane === null || lane === openLane) return;
    if (moved) {
      // Another lane was opened from somewhere else (the one on show was removed, say): turn to it.
      const next = laneUnit(openLane);
      setUnit(next);
      storeRackUnit(next);
    } else if (studio.synths.some(synth => synth.id === lane)) {
      // The view chose the lane, as when a remembered unit is shown on a new visit: open it.
      studio.setSelectedSynthId(lane);
    }
  }, [narrow, unit, openLane, lanes]);
  // Guests that are not on show stay laid out, out of sight (rack.css), so their pages go on
  // running. They are also put out of reach of the keyboard and of a screen reader.
  useLayoutEffect(() => {
    const away = paged && shown !== 'guests';
    pageRef.current?.querySelectorAll<HTMLElement>('.rack > [data-unit="guests"]').forEach((guest) => {
      guest.inert = away;
      if (away) guest.setAttribute('aria-hidden', 'true'); else guest.removeAttribute('aria-hidden');
    });
  }, [paged, shown, studio.guests.length]);

  return (
    <div ref={pageRef} className={narrow ? 'rack-page has-unit-bar' : 'rack-page'}>
      <div className="rack" data-shown={paged ? shown : undefined}>
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
        {(sync.updates.length > 0 || sync.ended.length > 0) && (
          <div role="status" className="app-alert">
            <span>
              {sync.updates.map(update => `${update.by} saved “${update.name}”, and this browser now has that version. `).join('')}
              {sync.ended.length > 0 && `${sync.ended.map(name => `“${name}”`).join(' and ')} ${sync.ended.length === 1 ? 'is' : 'are'} no longer shared with you. Your copy is still here, in this browser only.`}
            </span>
            <button className="rack-btn" onClick={projectSync.dismissShared} aria-label="Dismiss sharing message">✕</button>
          </div>
        )}
        {studio.guestRecording !== null && (
          <div role="status" className="app-alert">
            <span>
              Recording the guest instruments for the export. The music plays through, about {Math.ceil(studio.guestRecording)} seconds, and then the file downloads.
            </span>
          </div>
        )}
        {studio.exportStatus && studio.guestRecording === null && (
          <div role="status" className="export-status" data-phase={studio.exportStatus.phase}>
            <span>
              {studio.exportStatus.phase === 'working'
                ? `Making ${studio.exportStatus.what}${studio.exportStatus.part ? ` (${studio.exportStatus.part})` : ''}. A long song takes a while; the file downloads when it is done.`
                : `${studio.exportStatus.what} finished. The file has been downloaded.`}
            </span>
            {studio.exportStatus.phase === 'done' && <button className="rack-btn" onClick={studio.dismissExportStatus} aria-label="Dismiss export message">✕</button>}
          </div>
        )}
        {studio.storageError && (
          <div role="alert" className="app-alert">
            <span>{studio.storageError}</span>
            <button className="rack-btn" onClick={() => studio.setStorageError(null)} aria-label="Dismiss message">✕</button>
          </div>
        )}
        <StarterUnit studio={studio} />
        <SongModule studio={studio} onHelp={openHelpAt} />
        {shownLanes(studio.synths.map(entry => entry.id)).map(id => <SynthModule key={id} studio={studio} synthId={id} synth={studio.synths.find(entry => entry.id === id)} onHelp={openHelpAt} />)}
        <AddLaneUnit studio={studio} />
        {studio.guests.map(guest => <GuestModule key={guest.id} studio={studio} guest={guest} onHelp={openHelpAt} />)}
        <DrumModule studio={studio} onHelp={openHelpAt} />
        <MixerModule studio={studio} channels={mixer.current} onHelp={openHelpAt} />
        <div className="rack-unit effects-unit" data-unit="effects">
          <EffectsPanel effectsLoop={studio.effectsLoop} onChange={studio.handleEffectsLoopChange} onHelp={openHelpAt} />
        </div>
      </div>
      {narrow && (
        <UnitBar
          shown={shown}
          synths={studio.synths}
          drums={studio.drumState}
          playing={studio.isAnyPlaying}
          guests={hasGuests}
          onShow={show}
          onMuteLane={(id, muted) => { void studio.handleSynthMixChange(id, { muted }); }}
          onMuteDrums={studio.handleDrumMuteAll}
        />
      )}

      <HelpModal open={studio.helpOpen} at={helpAt} onClose={() => studio.setHelpOpen(false)} onWalkthrough={startTour} />
      <MidiImportDialog studio={studio} />
      {projectsOpen && <ProjectsDialog studio={studio} onClose={() => setProjectsOpen(false)} />}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} onWalkthrough={startTour} />}
      {tourOpen && <Walkthrough onClose={endTour} signedIn={user !== null} narrow={narrow} unit={paged ? shown : undefined} onUnit={paged ? setUnit : undefined} />}
      {guestOpen && <AddGuestDialog studio={studio} onClose={() => setGuestOpen(false)} onAdded={() => setUnit(current => (current === 'all' ? current : 'guests'))} />}
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
            drumChannel={studio.midiDrumChannel}
            onDrumChannelChange={studio.setMidiDrumChannel}
            ties={studio.midiTies}
            learning={studio.midiLearn}
            onLearn={studio.handleMidiLearn}
            onTieRemove={studio.handleMidiTieRemove}
            pads={studio.midiPads}
            padLearning={studio.midiPadLearn}
            onPadLearn={studio.handleMidiPadLearn}
            onPadsReset={studio.handleMidiPadsReset}
            destinations={studio.midiDestinations}
            onDestinationChange={studio.handleMidiDestinationChange}
            synthIds={studio.synths.map(synth => synth.id)}
            targetSynthId={studio.midiTargetSynthId}
            onTargetSynthChange={studio.setMidiTargetSynthId}
            lastMessage={midiState.lastMessage}
            error={midiState.error}
            outputs={midiState.outputs}
            selectedOutputId={midiState.selectedOutputId}
            onOutputChange={midiState.setSelectedOutputId}
            sendNotes={studio.midiOutNotes}
            onSendNotesChange={studio.setMidiOutNotes}
            sendClock={studio.midiOutClock}
            onSendClockChange={studio.setMidiOutClock}
          />
          <SamplePanel onPlay={sample => playSample(sample.data)} />
        </Dialog>
      )}
    </div>
  );
}
