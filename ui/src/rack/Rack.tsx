import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
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
import { shownDrumRows } from '../services/drumKits';
import SongModule from './SongModule';
import StarterUnit from './StarterUnit';
import Dialog from './Dialog';
import ReceivedSounds from './ReceivedSounds';
import ProjectsDialog from './ProjectsDialog';
import ShareDialog from './ShareDialog';
import LiveSessionDialog from './LiveSessionDialog';
import AccountDialog, { useAccountUser, useSyncStatus } from './AccountDialog';
import { projectSync } from '../services/projectSync';
import { liveJam, livePlace, liveStatus, liveSummary, liveUnavailableReason, retryLiveSession, subscribeLive } from '../services/liveSession';
import { markWalkthroughSeen } from '../services/walkthrough';
import Walkthrough from './Walkthrough';
import MidiImportDialog from './MidiImportDialog';
import GuestModule from './GuestModule';
import AddGuestDialog from './AddGuestDialog';
import VersionsDialog from './VersionsDialog';
import { HelpModal } from './HeaderParts';
import ShortcutsDialog from './ShortcutsDialog';
import SessionRecordButton from './SessionRecordButton';
import ColourSchemeDialog from './ColourSchemeDialog';
import { opensShortcuts } from '../services/shortcuts';
import { useWakeLock } from '../hooks/useWakeLock';
import { useNarrow } from '../hooks/useNarrow';
import { laneUnit, storeRackUnit, storedRackUnit, unitLane, type RackUnit } from '../services/rackView';
import UnitBar from './UnitBar';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './rack.css';
import AddLaneUnit from './AddLaneUnit';
import DeskTrackList from './DeskTrackList';
import DeskDockBar from './DeskDockBar';
import DeskSong from './DeskSong';
import DeskSheetBar from './DeskSheetBar';
import { SHEET_BAR, sheetHeight, storeSheetSize, storedSheetSize, type SheetSize } from '../services/deskSheet';
import { livePeople, parsePeople, type Person } from './DeskPeople';
import { presenceSelector, storeDeskView, storedDeskView, type DeskView } from '../services/deskSong';
import { laneName, shownLanes } from '../services/lanes';
import { layoutChoice } from '../services/layoutChoice';
import { clampDockHeight, dockUnit, storeDock, storeDockHeight, storedDock, storedDockHeight, trackLane, type DeskDock, laneTrack, type DeskTrack } from '../services/deskFrame';

// The whole instrument as one rack, read top to bottom: transport, three synth lanes,
// the drum grid, the mixer, then the shared effects.
// The name of whoever started the music in a live session with others in it, or nothing. A plain
// string, so the store's snapshot is the same until it changes.
const livePlayer = () => {
  const status = liveStatus();
  return status.state === 'live' && status.others.length > 0 ? status.playing?.by ?? '' : '';
};
// The live connection is lost and waiting to try again, so Rejoin Now is offered.
const liveLost = () => !liveUnavailableReason() && liveStatus().state === 'closed';

export default function Rack({ studio }: { studio: Studio }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // The section Help opens at when it was asked for from a unit's own "?". It is how Help was
  // reached, so it is kept here; whether Help is open is the studio's, and when that says it has
  // closed (by its button, Escape or the walkthrough) the section is forgotten.
  const [helpAt, setHelpAt] = useState<string | null>(null);
  // The list of keyboard shortcuts: view state, opened with Shift + ? or from Help.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!opensShortcuts(event, event.target) || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
  // Who started the music in this live session (liveSession.ts), shown while it is not playing here.
  const playingBy = useSyncExternalStore(subscribeLive, livePlayer);
  const peopleText = useSyncExternalStore(subscribeLive, livePeople);
  const people = useMemo(() => parsePeople(peopleText), [peopleText]);
  const snap = useSyncExternalStore(subscribeLive, liveJam.snap);
  const liveMessage = useSyncExternalStore(subscribeLive, liveSummary);
  const lost = useSyncExternalStore(subscribeLive, liveLost);

  // The mixer is handed the levels it shows, already gathered, and the same object for as long as
  // none of them changes: the lanes and the drums are new objects after every note and step.
  const { synths, drumState, drumMasterVolume, guests, audioTracks, effectsLoop, browserVolume, laneOrder } = studio;
  const levels = useMemo(
    () => mixerChannels({ synths, drumState, drumMasterVolume, guests, audioTracks, effectsLoop, browserVolume, laneOrder }),
    [synths, drumState, drumMasterVolume, guests, audioTracks, effectsLoop, browserVolume, laneOrder],
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
  const desk = useSyncExternalStore(layoutChoice.subscribe, layoutChoice.get) === 'desk';
  const shown = unit === 'guests' && !hasGuests ? laneUnit(studio.selectedSynthId) : unit;
  // The desk replaces the bar of units on a phone, so nothing is paged then.
  const paged = narrow && !desk && shown !== 'all';
  // The desk layout on a wide screen (docs/DESK_LAYOUT_PLAN.md, stage 2): the dock shows one unit,
  // chosen by the track list and its tabs. Like `shown`, it is view state kept here and handed to the
  // stylesheet as an attribute; the units are hidden, never taken away. Which track and tab, and how
  // tall, are this browser's (services/deskFrame.ts).
  const deskWide = desk && !narrow;
  // The desk on a phone (stage 5): the song as a short strip, the tracks as a list and the dock as a sheet
  // raised from the bottom edge. Its size is this browser's (services/deskSheet.ts); whether it is up is
  // view state, and it starts put away.
  const deskPhone = desk && narrow;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSize, setSheetSizeState] = useState<SheetSize>(storedSheetSize);
  const [sheetLive, setSheetLive] = useState<number | null>(null);
  const sheetFrom = useRef<HTMLElement | null>(null);
  const setSheetSize = (size: SheetSize) => { setSheetSizeState(size); storeSheetSize(size); };
  const [dock, setDock] = useState<DeskDock>(storedDock);
  const [dockHeight, setDockHeight] = useState(storedDockHeight);
  // Which view the tracks region shows. It changes what the middle shows, never what plays.
  const [deskView, setDeskViewState] = useState<DeskView>(storedDeskView);
  const setDeskView = (view: DeskView) => { setDeskViewState(view); storeDeskView(view); };
  const [viewport, setViewport] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!desk) return;
    const onResize = () => setViewport(window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [desk]);
  const deskTrack: DeskTrack = (() => {
    const track = dock.track;
    const lane = track === null ? null : trackLane(track);
    if (track === null || (lane !== null && !studio.synths.some(synth => synth.id === lane)) || (track === 'guests' && !hasGuests)) return laneTrack(studio.selectedSynthId);
    return track;
  })();
  const dockShown = dockUnit(deskTrack, dock.tab);
  const deskLane = trackLane(deskTrack);
  const dockTrackName = deskLane !== null ? laneName(deskLane, studio.synths.find(synth => synth.id === deskLane)?.name) : deskTrack === 'drums' ? 'Drums' : 'Guests';
  const showDock = (next: Partial<DeskDock>) => {
    const value = { track: next.track ?? deskTrack, tab: next.tab ?? dock.tab };
    setDock(value);
    storeDock(value);
  };
  // `from` is a header that was pressed: on a phone that raises the sheet, and is where focus goes back to.
  const showTrack = (track: DeskTrack, from?: HTMLElement) => {
    const lane = trackLane(track);
    if (lane !== null) studio.setSelectedSynthId(lane);
    showDock({ track, tab: 'track' });
    if (deskPhone && from) {
      sheetFrom.current = from;
      setSheetOpen(true);
    }
  };
  const deskHeight = clampDockHeight(dockHeight, viewport);
  const sheetPx = sheetLive ?? sheetHeight(sheetSize, viewport);
  // The sheet takes focus when it is raised, and gives it back to the header that raised it when it is put
  // away. A header that would be under the sheet is scrolled clear of it.
  const sheetWas = useRef(false);
  useEffect(() => {
    const was = sheetWas.current;
    sheetWas.current = sheetOpen;
    const page = pageRef.current;
    if (!page || was === sheetOpen) return;
    if (sheetOpen) {
      const from = sheetFrom.current;
      if (from?.isConnected) {
        const under = from.getBoundingClientRect().bottom - (window.innerHeight - sheetHeight(sheetSize, window.innerHeight));
        if (under > -8) page.scrollTop += under + 8;
      }
      page.querySelector<HTMLElement>('.desk-sheet-bar [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    } else {
      const from = sheetFrom.current;
      sheetFrom.current = null;
      const target = from?.isConnected ? from : page.querySelector<HTMLElement>(`.desk-tracks .desk-track[data-track="${deskTrack}"] .desk-track-pick`);
      target?.focus({ preventScroll: true });
    }
  }, [sheetOpen]);
  useEffect(() => {
    if (!deskPhone || !sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest('.desk-sheet-bar, .rack [data-unit]')) return;
      setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deskPhone, sheetOpen]);
  const setHeight = (height: number, keep: boolean) => {
    setDockHeight(height);
    if (keep) storeDockHeight(height);
  };
  // The open lane and the lane on the dock are kept the same one, as the phone's are (below).
  const lastDeskLane = useRef(studio.selectedSynthId);
  useEffect(() => {
    const moved = lastDeskLane.current !== studio.selectedSynthId;
    lastDeskLane.current = studio.selectedSynthId;
    const lane = trackLane(deskTrack);
    if (!desk || lane === null || lane === studio.selectedSynthId) return;
    if (moved) showDock({ track: laneTrack(studio.selectedSynthId) });
    else if (studio.synths.some(synth => synth.id === lane)) studio.setSelectedSynthId(lane);
  }, [desk, deskTrack, studio.selectedSynthId, studio.synths.length]);
  // Counts the times a unit was asked for from the bar, so the page can settle after each.
  const [moves, setMoves] = useState(0);
  const show = (next: RackUnit) => {
    const lane = unitLane(next);
    if (lane !== null && studio.synths.some(synth => synth.id === lane)) studio.setSelectedSynthId(lane);
    setUnit(next);
    storeRackUnit(next);
    setMoves(count => count + 1);
  };
  // How tall the transport is, for the column beside the lanes on a wide screen, which is held in
  // view just under it.
  useLayoutEffect(() => {
    const page = pageRef.current, transport = page?.querySelector<HTMLElement>('.rack > .transport');
    if (!page || !transport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => page.style.setProperty('--transport-height', `${transport.offsetHeight}px`));
    observer.observe(transport);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || moves === 0) return;
    // The new unit starts at its top, just under the transport.
    page.scrollTop = 0;
    // Focus goes into the unit that was asked for, so the next Tab is inside it and a screen
    // reader says where it is. The whole rack has no one place to go, and focus stays on the bar.
    if (shown === 'all') return;
    const target = page.querySelector<HTMLElement>(`.rack [data-unit="${shown}"]`);
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
    if (!narrow || desk || lane === null || lane === openLane) return;
    if (moved) {
      // Another lane was opened from somewhere else (the one on show was removed, say): turn to it.
      const next = laneUnit(openLane);
      setUnit(next);
      storeRackUnit(next);
    } else if (studio.synths.some(synth => synth.id === lane)) {
      // The view chose the lane, as when a remembered unit is shown on a new visit: open it.
      studio.setSelectedSynthId(lane);
    }
  }, [narrow, desk, unit, openLane, lanes]);
  // The transport unit is tracked, so what it is handed must stay the same from render to render.
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openProjects = useCallback(() => setProjectsOpen(true), []);
  const openShare = useCallback(() => setShareOpen(true), []);
  const openLive = useCallback(() => setLiveOpen(true), []);
  const openAccount = useCallback(() => setAccountOpen(true), []);
  const openGuest = useCallback(() => setGuestOpen(true), []);
  const openVersions = useCallback(() => setVersionsOpen(true), []);
  const [coloursOpen, setColoursOpen] = useState(false);
  const openColours = useCallback(() => setColoursOpen(true), []);
  // A live session: the unit this person is at is the one they last pressed or moved the keyboard
  // into, and the units the others are at carry their colour and names. The marks are attributes set
  // here, as `data-shown` is, so no unit renders for them.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const note = (event: Event) => {
      const marked = (event.target as Element | null)?.closest?.('.rack [data-unit], .desk-tracks .desk-track[data-track]');
      const at = marked?.getAttribute('data-unit') ?? marked?.getAttribute('data-track');
      if (at) livePlace(at);
    };
    page.addEventListener('pointerdown', note, true);
    page.addEventListener('focusin', note, true);
    return () => {
      page.removeEventListener('pointerdown', note, true);
      page.removeEventListener('focusin', note, true);
    };
  }, []);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    page.querySelectorAll<HTMLElement>('[data-present]').forEach((marked) => {
      marked.removeAttribute('data-present');
      marked.removeAttribute('data-present-names');
      marked.style.removeProperty('--present');
    });
    const byUnit = new Map<string, Person[]>();
    for (const person of people) if (person[2]) byUnit.set(person[2], [...(byUnit.get(person[2]) ?? []), person]);
    for (const [at, here] of byUnit) {
      const selector = presenceSelector(at);
      if (!selector) continue;
      page.querySelectorAll<HTMLElement>(selector).forEach((marked) => {
        marked.setAttribute('data-present', String(here[0][1]));
        marked.setAttribute('data-present-names', here.map(person => person[0]).join(', '));
        marked.style.setProperty('--present', `var(--person-${here[0][1]})`);
      });
    }
  });
  // Guests that are not on show stay laid out, out of sight (rack.css), so their pages go on
  // running. They are also put out of reach of the keyboard and of a screen reader.
  useLayoutEffect(() => {
    const away = (paged && shown !== 'guests') || (deskWide && dockShown !== 'guests') || (deskPhone && (!sheetOpen || dockShown !== 'guests'));
    pageRef.current?.querySelectorAll<HTMLElement>('.rack [data-unit="guests"]').forEach((guest) => {
      guest.inert = away;
      if (away) guest.setAttribute('aria-hidden', 'true'); else guest.removeAttribute('aria-hidden');
    });
  }, [paged, shown, deskWide, deskPhone, sheetOpen, dockShown, studio.guests.length]);

  return (
    <div
      ref={pageRef}
      className={deskPhone ? `rack-page desk-phone${sheetOpen ? ' sheet-open' : ''}` : narrow ? 'rack-page has-unit-bar' : deskWide ? 'rack-page desk-frame' : 'rack-page'}
      style={deskWide ? { '--dock-height': `${deskHeight}px` } as CSSProperties : deskPhone ? { '--sheet-height': `${sheetPx}px`, '--sheet-bar': `${SHEET_BAR}px` } as CSSProperties : undefined}
    >
      <div className="rack" data-shown={paged ? shown : undefined} data-dock={deskWide ? dockShown : deskPhone ? (sheetOpen ? dockShown : 'none') : undefined}>
        <TransportUnit
          studio={studio}
          onOpenSettings={openSettings}
          onOpenProjects={openProjects}
          onShare={openShare}
          onStartLive={openLive}
          onOpenAccount={openAccount}
          onAddGuest={openGuest}
          onOpenVersions={openVersions}
          onOpenColours={openColours}
        />
        {/* The alerts: no box of their own, except in the desk, where they are a strip above the song. */}
        <div className="rack-top">
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
        {user && (sync.shared[studio.projectId] || sync.sharedByMe[studio.projectId]) && (
          <div role="status" className="live-people">
            <span>{liveMessage}</span>
            {/* The spaces and commas are in the text, so it reads as words and not only as it looks. */}
            {people.map(([user, colour], at) => (
              <Fragment key={user}>
                {' '}
                <span className="live-person" style={{ '--present': `var(--person-${colour})` } as CSSProperties}>{user}</span>
                {at < people.length - 1 ? ',' : ''}
              </Fragment>
            ))}
            {people.length > 0 && <button
              className={`rack-btn live-snap ${snap ? 'on' : ''}`}
              aria-pressed={snap}
              onClick={() => liveJam.setSnap(!snap)}
              title="While the music plays, the notes the others play start on the next step here, so the time they take to arrive is not heard"
            >
              Snap their notes to the beat
            </button>}
            {people.length > 0 && <SessionRecordButton onToggle={() => { void studio.handleRecordSession(); }} />}
            {lost && <button className="rack-btn live-rejoin" onClick={retryLiveSession}>Rejoin Now</button>}
            <button className="rack-btn" onClick={openLive}>Session Setup</button>
          </div>
        )}
        {playingBy && !studio.isAnyPlaying && (
          <div role="status" className="app-alert">
            <span>{playingBy} is playing in this live session. Press Play to listen along.</span>
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
            {studio.exportStatus.phase === 'working' && studio.exportStatus.progress !== undefined && <progress className="export-bar" aria-label="Export progress" max={100} value={Math.round(studio.exportStatus.progress * 100)} />}
            {studio.exportStatus.phase === 'done' && <button className="rack-btn" onClick={studio.dismissExportStatus} aria-label="Dismiss export message">✕</button>}
          </div>
        )}
        {studio.storageError && (
          <div role="alert" className="app-alert">
            <span>{studio.storageError}</span>
            <button className="rack-btn" onClick={() => studio.setStorageError(null)} aria-label="Dismiss message">✕</button>
          </div>
        )}
        </div>
        {/* The desk's track list, only while the desk is on and the screen is wide. */}
        {desk && (
          <DeskTrackList
            synths={studio.synths}
            laneOrder={studio.laneOrder}
            drums={studio.drumState}
            guests={studio.guests}
            track={deskTrack}
            bars={studio.sceneInfo[studio.currentSceneId]?.bars ?? 1}
            signature={studio.signature}
            playing={studio.isAnyPlaying}
            onShow={showTrack}
            onAssignNotes={(id, step, notes, on) => { void studio.handlePianoRollNoteAssign(id, step, notes, on); }}
            onSelectStep={studio.handleStepSelect}
            onToggleDrum={studio.handleDrumStepToggle}
            onMuteLane={(id, muted) => { void studio.handleSynthMixChange(id, { muted }); }}
            onSoloLane={(id, solo) => { void studio.handleSynthMixChange(id, { solo }); }}
            onMuteDrums={studio.handleDrumMuteAll}
            view={deskView}
            onView={setDeskView}
            songView={deskView === 'song' ? <DeskSong studio={studio} track={deskTrack} view={deskView} onView={setDeskView} onShow={showTrack} /> : null}
            onAddLane={(id) => { void studio.ensureSynthExists(id).then((created) => { if (created) { studio.setSelectedSynthId(id); showDock({ track: laneTrack(id), tab: 'track' }); } }); }}
          />
        )}
        {/* The units, in two groups: on a wide screen the second is a column of its own beside the
            first, and otherwise neither makes a box of its own (rack.css). */}
        <div className="rack-main">
        <div className="rack-song-area">
        <StarterUnit studio={studio} />
        <SongModule studio={studio} onHelp={openHelpAt} />
        </div>
        {deskWide && (
          <DeskDockBar
            trackName={dockTrackName}
            tab={dock.tab}
            onTab={tab => showDock({ tab })}
            height={deskHeight}
            viewport={viewport}
            onHeight={setHeight}
          />
        )}
        {shownLanes(studio.synths.map(entry => entry.id), studio.laneOrder).map(id => <SynthModule key={id} studio={studio} synthId={id} synth={studio.synths.find(entry => entry.id === id)} onHelp={openHelpAt} />)}
        <AddLaneUnit studio={studio} />
        <div className="rack-guests">
        {studio.guests.map(guest => <GuestModule key={guest.id} studio={studio} guest={guest} onHelp={openHelpAt} />)}
        </div>
        <DrumModule studio={studio} onHelp={openHelpAt} />
        </div>
        <div className="rack-side">
        <MixerModule studio={studio} channels={mixer.current} onHelp={openHelpAt} />
        <div className="rack-unit effects-unit" data-unit="effects">
          <EffectsPanel effectsLoop={studio.effectsLoop} onChange={studio.handleEffectsLoopChange} onHelp={openHelpAt} />
        </div>
        </div>
      </div>
      {deskPhone && sheetOpen && (
        <DeskSheetBar
          trackName={dockTrackName}
          tab={dock.tab}
          onTab={tab => showDock({ tab })}
          size={sheetSize}
          height={sheetPx}
          viewport={viewport}
          onSize={setSheetSize}
          onLive={setSheetLive}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {narrow && !desk && (
        <UnitBar
          shown={shown}
          synths={studio.synths}
          laneOrder={studio.laneOrder}
          drums={studio.drumState}
          playing={studio.isAnyPlaying}
          guests={hasGuests}
          onShow={show}
          onMuteLane={(id, muted) => { void studio.handleSynthMixChange(id, { muted }); }}
          onMuteDrums={studio.handleDrumMuteAll}
        />
      )}

      <HelpModal open={studio.helpOpen} at={helpAt} onClose={() => studio.setHelpOpen(false)} onWalkthrough={startTour} onShortcuts={() => { studio.setHelpOpen(false); setShortcutsOpen(true); }} />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {coloursOpen && <ColourSchemeDialog onClose={() => setColoursOpen(false)} />}
      <MidiImportDialog studio={studio} />
      <ReceivedSounds studio={studio} />
      {projectsOpen && <ProjectsDialog studio={studio} onClose={() => setProjectsOpen(false)} />}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {liveOpen && <LiveSessionDialog key={studio.projectId} studio={studio} onClose={() => setLiveOpen(false)} onSignIn={openAccount} />}
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
            drumRows={shownDrumRows(studio.drumState)}
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
            sendPlayed={studio.midiOutPlayed}
            onSendPlayedChange={studio.setMidiOutPlayed}
            outChannels={studio.midiOutChannels}
            onOutChannelsChange={studio.setMidiOutChannels}
            followClock={studio.midiFollowClock}
            onFollowClockChange={studio.setMidiFollowClock}
            clockTempo={studio.externalTempo}
          />
          <SamplePanel onPlay={sample => playSample(sample.data)} />
        </Dialog>
      )}
    </div>
  );
}
