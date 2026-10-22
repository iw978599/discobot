// Exporting: MIDI files of the open scene and the song, and audio (WAV, a loop, stems),
// which first plays the song through to record any guest instruments. Split out of useStudio.tsx.
import { useCallback } from 'react';
import { Scene } from '../types';
import { guestBarGains, sceneDrumState } from '../services/songPlayback';
import { sceneAsBars, sceneBars } from '../services/patternLength';
import { guestCapture, guestLink, wallNow } from '../services/guests';
import { downloadArrangementWav, downloadStemsZip } from '../services/wavExport';
import { arrangementWholes, EXPORT_RATE, ExportArrangement, loopPass } from '../services/wavExport';
import { loadRecordings } from '../services/clipRecordings';
import { songSecondsAt } from '../services/clipTiming';
import { renderTrackTakes } from '../services/trackRender';
import { downloadMidiFile } from '../utils/midiExport';
import { guestInputs, leaveOutHanded } from '../services/guestInput';
import { clonePattern, cloneDrumState } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioExportNeeds {
  songArrangement: () => Promise<ExportArrangement & { bars: Scene[]; }>;
}

export function useStudioExport(core: StudioCore, needs: StudioExportNeeds) {
  const { synthsRef, globalTempo, drumStateRef, audioTracksRef, scenesRef, songRef, sceneLengthRef, signatureOfRef, drumSwing, drumSwingGrid, drumMasterVolume, liveSceneRef, globalTempoRef, selectedDrumKitIdRef, drumFxRef, effectsLoopRef, drumSamplesRef, synthSamplesRef, cymbalsRef, currentArrangementRef, guestsRef, handedByBarRef, playModeRef, songStartEntryRef, handleGlobalPlayStopRef, setGuestRecording, setPlayMode, setSongStartEntry, exportingRef, doneTimerRef, setExportStatus, setStorageError } = core;
  const { songArrangement } = needs;
  const handleExportMidi = useCallback(() => {
    const synthLanes = synthsRef.current
      .filter((entry) => entry.pattern)
      .map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: entry.muted, solo: entry.solo, swing: entry.swing }));
    downloadMidiFile(
      {
        tempo: liveSceneRef.current().tempo ?? globalTempo,
        synthLanes,
        drumState: cloneDrumState(drumStateRef.current),
        drumSwing, drumSwingGrid,
        drumMasterVolume,
        signature: liveSceneRef.current().signature,
        ...(sceneBars(liveSceneRef.current()) > 1 ? {
          bars: sceneAsBars(liveSceneRef.current()).map(scene => ({ name: scene.name, signature: scene.signature, lanes: scene.lanes, drumState: sceneDrumState(scene, drumStateRef.current) })),
        } : {}),
      },
      `discobot-${Date.now()}.mid`
    );
  }, [globalTempo, drumSwing, drumSwingGrid, drumMasterVolume]);
  const currentArrangement = useCallback((): ExportArrangement => ({
    // The open scene at its own tempo, when it has one (roadmap 17).
    tempo: liveSceneRef.current().tempo ?? globalTempoRef.current, synths: synthsRef.current, drumState: drumStateRef.current,
    drumKitId: selectedDrumKitIdRef.current, drumMasterVolume, drumSwing, drumSwingGrid,
    drumFx: drumFxRef.current, effectsLoop: effectsLoopRef.current, drumSamples: { ...drumSamplesRef.current },
    synthSamples: { ...synthSamplesRef.current }, drumCymbals: cymbalsRef.current,
    ...(liveSceneRef.current().signature ? { signature: liveSceneRef.current().signature } : {}),
    // A scene longer than one bar is rendered a bar at a time, each lane looping at its own length.
    ...(sceneBars(liveSceneRef.current()) > 1 ? { bars: sceneAsBars(liveSceneRef.current()) } : {}),
  }), [drumMasterVolume, drumSwing, drumSwingGrid]);
  currentArrangementRef.current = currentArrangement;
  const handleExportSongMidi = useCallback(async () => {
    const { bars } = await songArrangement();
    const kit = cloneDrumState(drumStateRef.current);
    downloadMidiFile(
      {
        tempo: globalTempoRef.current, drumSwing, drumSwingGrid, drumMasterVolume, drumState: kit,
        synthLanes: synthsRef.current.filter((entry) => entry.pattern).map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: false, solo: false, swing: entry.swing })),
        bars: bars.map(scene => ({ name: scene.name, signature: scene.signature, tempo: scene.tempo, lanes: scene.lanes, drumState: sceneDrumState(scene, kit) })),
      },
      `discobot-song-${Date.now()}.mid`
    );
  }, [songArrangement, drumSwing, drumSwingGrid, drumMasterVolume]);
  // Every audio export. With guests in the project the arrangement is first played through in
  // real time so their sound can be recorded; then the export is rendered as usual. A loop is
  // played through twice and the second pass kept: by then what rings on from the end of the
  // pattern is sounding over its start, which is what makes the loop seamless.
  const exportWav = useCallback(async (kind: boolean | 'pattern' | 'song' | 'loop' | 'stems', onProgress: (progress: number, part?: string) => void) => {
    const wholeSong = kind === true || kind === 'song', loop = kind === 'loop';
    let arrangement: ExportArrangement = wholeSong ? await songArrangement() : currentArrangementRef.current();
    // A song gives each guest its scene's own level and mute bar by bar, so a guest is recorded
    // if any scene of the song plays it, whatever the open scene says.
    const songGains = wholeSong && arrangement.bars ? new Map(guestsRef.current.map(guest => [guest.id, guestBarGains(arrangement.bars!, guest)])) : null;
    const audible = guestsRef.current.filter(guest => songGains ? songGains.get(guest.id)!.some(gain => gain > 0) : !guest.muted && guest.volume > 0);
    // A voice with a guest is heard through the guest, in the take, and left out of the render.
    // Without a play-through it is with a guest that is silent, as it is when playing.
    handedByBarRef.current = [guestInputs.all().map(entry => entry.source)];
    if (audible.length > 0 && !guestCapture.active()) {
      // How long what is exported lasts: its bars, each as long as its scene's time signature makes it.
      const wholes = arrangementWholes(arrangement);
      const passFrames = loopPass(globalTempoRef.current, 44100, wholes).frames;
      const seconds = (loop ? 2 : 1) * wholes * 240 / globalTempoRef.current;
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const mode = playModeRef.current, startEntry = songStartEntryRef.current;
      try {
        if (synthsRef.current.some(synth => synth.isPlaying)) { await handleGlobalPlayStopRef.current(); await sleep(150); }
        setGuestRecording(seconds);
        // Each bar the play-through schedules says which voices are with a guest, from the first.
        handedByBarRef.current = [];
        // Play exactly what is being exported: the song from its start, or the open scene.
        playModeRef.current = wholeSong ? 'song' : 'pattern';
        songStartEntryRef.current = 0;
        setPlayMode(playModeRef.current);
        setSongStartEntry(0);
        await handleGlobalPlayStopRef.current();
        // The transport announces where its first beat falls; recording is lined up against that.
        for (let waited = 0; waited < 4000 && !guestLink.transport().playing; waited += 20) await sleep(20);
        const transport = guestLink.transport();
        if (!transport.playing) throw new Error('Playback did not start, so the guest instruments could not be recorded.');
        guestCapture.start(transport.anchorWall, seconds + 2);
        await sleep(Math.max(0, transport.anchorWall - wallNow()) + seconds * 1000);
        if (synthsRef.current.some(synth => synth.isPlaying)) await handleGlobalPlayStopRef.current();
        // A moment for the last of the guests' audio to arrive.
        await sleep(600);
        const takes = guestCapture.stop();
        arrangement = {
          ...arrangement,
          guestTakes: audible.flatMap(guest => {
            const take = takes.get(guest.id);
            if (!take) return [];
            const [left, right] = [take.left, take.right].map(channel => (loop ? channel.slice(passFrames, passFrames * 2) : channel));
            return [{ left, right, gain: guest.volume, ...(songGains ? { gains: songGains.get(guest.id) } : {}), name: guest.name, ...(guest.sends ? { sends: guest.sends } : {}) }];
          }),
        };
      } finally {
        guestCapture.stop();
        setGuestRecording(null);
        setPlayMode(mode);
        setSongStartEntry(startEntry);
      }
    }
    // A song's audio tracks, each clip where it falls in the song (docs/TIMELINE_PLAN.md).
    if (wholeSong && audioTracksRef.current.length > 0) {
      const tracks = audioTracksRef.current;
      const recordings = await loadRecordings(tracks.flatMap(track => track.clips.map(clip => clip.sampleId)));
      const tempoOf = (sceneId: string) => scenesRef.current.find(scene => scene.id === sceneId)?.tempo;
      const secondsOf = (tick: number) => songSecondsAt(songRef.current, tick, sceneLengthRef.current, signatureOfRef.current, globalTempoRef.current, tempoOf);
      const end = tracks.reduce((last, track) => track.clips.reduce((latest, clip) => Math.max(latest, secondsOf(clip.at) + clip.length), last), 0);
      const trackTakes = renderTrackTakes(tracks, recordings, secondsOf, Math.ceil(end * EXPORT_RATE), EXPORT_RATE);
      if (trackTakes.length > 0) arrangement = { ...arrangement, trackTakes };
    }
    arrangement = leaveOutHanded(arrangement, handedByBarRef.current);
    if (kind === 'stems') await downloadStemsZip(arrangement, (done, total, fraction) => onProgress(fraction, `file ${done + 1} of ${total}`));
    else await downloadArrangementWav(arrangement, { ...(loop ? { loop: true } : {}), onProgress: fraction => onProgress(fraction) });
  }, [songArrangement]);
  const handleExportWav = useCallback(async (kind: boolean | 'pattern' | 'song' | 'loop' | 'stems') => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    const what = kind === true || kind === 'song' ? 'Song WAV' : kind === 'loop' ? 'Loop WAV' : kind === 'stems' ? 'Stems' : 'Scene WAV';
    setExportStatus({ phase: 'working', what, progress: 0 });
    // A moment for the message to be painted before the render takes the page's thread.
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      await exportWav(kind, (progress, part) => setExportStatus({ phase: 'working', what, part, progress }));
      setExportStatus({ phase: 'done', what });
      doneTimerRef.current = setTimeout(() => setExportStatus(null), 12000);
    } catch (error) {
      setExportStatus(null);
      throw error;
    } finally {
      exportingRef.current = false;
    }
  }, [exportWav]);
  const dismissExportStatus = useCallback(() => setExportStatus(null), []);
  const reportExportError = useCallback((error: unknown) => {
    setStorageError(`Audio export failed: ${error instanceof Error ? error.message : error}`);
  }, []);
  return { handleExportMidi, currentArrangement, handleExportSongMidi, handleExportWav, dismissExportStatus, reportExportError };
}
