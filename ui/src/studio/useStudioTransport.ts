// The transport and its scheduler: what each tick plays (lanes, drums, song scenes, the count-in,
// MIDI out, automation), the step lights, Play and Stop, and the music of a live session. Split out
// of useStudio.tsx.
import { useCallback, useRef, useEffect } from 'react';
import { midiOut } from '../services/midiOutput';
import { SequencerStep, SynthParameters, DrumInstrument, Scene, TimeSignature } from '../types';
import { audibleLanes, entryStartTick, sceneAtTick, sceneDrumState, songLengthTicks } from '../services/songPlayback';
import { localService } from '../services/localService';
import { LIVE_LEAD_SECONDS, liveTransport } from '../services/liveSession';
import { barSteps, barTicks, drumBars, laneBars } from '../services/patternLength';
import { contextTimeAtWall, guestLink, wallAtContextTime } from '../services/guests';
import { playhead } from '../services/playhead';
import { stepSends, stepVoiceParams } from '../services/automation';
import { CLICK_LEVEL, clickAt, clickLevel, countInBars } from '../services/metronome';
import { BrowserTransport } from '../services/browserTransport';
import { expandDrumStep, swingLate } from '../services/drumScheduling';
import { swingSteps } from '../services/grooves';
import { trackPlayer } from '../hooks/trackAudio';
import { recordingNow } from '../services/clipRecordings';
import { clipsSounding, clipsStarting, songSecondsAt } from '../services/clipTiming';
import { DRUM_NOTE_MAP } from '../utils/midiExport';
import { guestInputs } from '../services/guestInput';
import { STEP_LIGHT_AHEAD, midiTime, resetMidiClock } from './studioState';
import type { PlayMode } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioTransportNeeds {
  sceneLength: (sceneId: string) => number;
  signatureOf: (sceneId: string) => TimeSignature | undefined;
  triggerStep: (synthParams: SynthParameters, step: SequencerStep, windowSeconds: number, synthId: number, scheduledTime: number) => void;
  endRecordedHolds: () => void;
}

export function useStudioTransport(core: StudioCore, needs: StudioTransportNeeds) {
  const { engine, transportRef, scheduleTickRef, countInRef, metronomeRef, playModeRef, songRef, songStartTickRef, songEndingRef, stopPlaybackRef, setSongPosition, currentSceneIdRef, scenesRef, barAnchorRef, exportingRef, handedByBarRef, synthsRef, autoPassRef, synthAudio, globalTempoRef, drumSwingRef, drumSwingGridRef, drumStateRef, audioTracksRef, externalTempoRef, midiFollowClockRef, drumAudio, synths, liveStartRef, songStartEntryRef, signatureOfRef, announceRef, sceneLengthRef, setStorageError, endAutoPassesRef, setSynths, handleGlobalPlayStopRef, setPlayMode, setSongStartEntry } = core;
  const { sceneLength, signatureOf, triggerStep, endRecordedHolds } = needs;
  const showStep = (lane: number | 'drums', step: number, time: number) => {
    const ahead = time - engine.getContext().currentTime;
    if (ahead <= STEP_LIGHT_AHEAD) { playhead.set(lane, step); return; }
    setTimeout(() => { if (transportRef.current?.running) playhead.set(lane, step); }, (ahead - STEP_LIGHT_AHEAD) * 1000);
  };
  scheduleTickRef.current = ({ tick: counted, time, duration }) => {
    // The count-in: its bars are clicked and nothing else happens in them. Everything after counts
    // from where the count-in ends.
    const countIn = countInRef.current;
    if (counted < countIn.ticks) {
      const kind = clickAt(counted % barTicks(countIn.signature), countIn.signature);
      if (kind) engine.scheduleClick(time, kind === 'bar', clickLevel(metronomeRef.current) / CLICK_LEVEL);
      return;
    }
    const tick = counted - countIn.ticks;
    if (midiOut.active) midiOut.tick(midiTime(time), duration * 1000, tick === 0);
    // The transport only counts ticks. How long a bar is comes from the time signature of the
    // scene that is playing, so which bar this is and where in it (`step`, in ticks) are worked
    // out here. `passBar` is where in its pattern each lane is: in song mode that is counted from
    // the start of the scene's pass; otherwise the bars just keep counting and lanes of different
    // lengths drift.
    let passBar = 0, step = 0;
    let signature: TimeSignature | undefined;
    // In song mode the tick picks the scene. A scene other than the one open for
    // editing is played from its stored copy; the open one is played from the live pattern.
    let scene: Scene | null = null;
    if (playModeRef.current === 'song') {
      const position = sceneAtTick(songRef.current, songStartTickRef.current + tick, sceneLength, signatureOf);
      if (!position) {
        if (!songEndingRef.current) {
          songEndingRef.current = true;
          // Stop on the bar line this tick belongs to, not now: ticks are scheduled a little ahead.
          setTimeout(() => stopPlaybackRef.current(), Math.max(0, (time - engine.getContext().currentTime) * 1000));
        }
        return;
      }
      passBar = position.bar;
      step = position.tick;
      signature = signatureOf(position.sceneId);
      playClips(songStartTickRef.current + tick, time);
      if (step === 0) {
        setSongPosition(position);
        // Open the playing scene in the editor. This updates the live pattern at once: selectScene
        // is synchronous, and the sceneChanged handler has written the refs before it returns.
        if (position.sceneId !== currentSceneIdRef.current) {
          localService.selectScene(position.sceneId);
        }
      }
      if (position.sceneId !== currentSceneIdRef.current) {
        scene = scenesRef.current.find(entry => entry.id === position.sceneId) ?? null;
      }
    } else {
      signature = signatureOf(currentSceneIdRef.current);
      const perBar = barTicks(signature), anchor = barAnchorRef.current;
      // A bar of another length starts a new bar here, on a whole step of the bar before. The first
      // bars count from where the music starts, which is the first tick unless the transport began
      // part of the way in (music someone else started in a live session).
      if (anchor.perBar === 0) barAnchorRef.current = { tick: 0, bar: 0, perBar };
      else if (anchor.perBar !== perBar && (tick - anchor.tick) % 2 === 0) {
        barAnchorRef.current = { tick, bar: anchor.bar + Math.ceil((tick - anchor.tick) / anchor.perBar), perBar };
      }
      const from = barAnchorRef.current;
      passBar = from.bar + Math.floor((tick - from.tick) / from.perBar);
      step = (tick - from.tick) % from.perBar;
    }
    // An export's play-through notes which voices are with a guest in each bar, to leave them out of its render.
    if (exportingRef.current && step === 0) handedByBarRef.current.push(guestInputs.all().map(entry => entry.source));
    if (metronomeRef.current.click && !exportingRef.current) {
      const kind = clickAt(step, signature);
      if (kind) engine.scheduleClick(time, kind === 'bar', clickLevel(metronomeRef.current) / CLICK_LEVEL);
    }
    const ticksPerBar = barTicks(signature);
    const lanes = synthsRef.current;
    // A scene played from its stored copy brings its own mutes; the open one's are on the lanes.
    const heard = audibleLanes(scene, lanes);
    for (const synth of lanes) {
      if (!synth.isPlaying || !synth.pattern || !synth.synthParams) continue;
      const steps = scene ? scene.lanes[synth.id] ?? [] : synth.pattern.steps;
      if (steps.length === 0) continue;
      const bars = laneBars(steps.length, scene ? scene.laneBars?.[synth.id] : synth.pattern.bars, signature);
      const perBar = steps.length / bars;
      // A lane of finer steps has one to a tick; any other uses every second tick.
      const divisor = perBar === ticksPerBar ? 1 : 2;
      if (step % divisor !== 0) continue;
      const index = (passBar % bars) * perBar + Math.floor(step / divisor) % perBar;
      const note = steps[index];
      // The step's automation, sent to sound when the step does. The lane's own sound is not
      // changed: this goes to the voice and nowhere else. A scene played from its stored copy
      // brings its own. A knob being recorded plays where it is, whatever the pattern holds.
      // A lane handed to a guest is played early by its lead (services/guestInput), so the guest has it in time.
      const early = guestInputs.leadSeconds(`synth:${synth.id}`);
      const automation = scene ? scene.laneAutomation?.[synth.id] : synth.pattern.automation, held = scene ? undefined : autoPassRef.current.get(synth.id)?.held;
      synthAudio.automate(synth.id, synth.synthParams, globalTempoRef.current,
        stepVoiceParams(synth.synthParams, automation, index, globalTempoRef.current, held), time - early, stepSends(synth.synthParams, automation, index, held));
      // A lane that swings plays late as the drums' swing moves their steps. Its automation stays on the step.
      const late = synth.swing ? swingLate(step * duration, duration * 2, drumSwingRef.current, drumSwingGridRef.current) : 0;
      if (heard.has(synth.id) && note?.active && note.note) {
        triggerStep(synth.synthParams, note, duration * divisor, synth.id, time + late - early);
      }
      // The step lights read this themselves. Setting state here would render the whole rack on every step.
      showStep(synth.id, index, time + late);
    }
    if (step % 2 !== 0) return;
    const state = scene ? sceneDrumState(scene, drumStateRef.current) : drumStateRef.current;
    const stepInBar = Math.floor(step / 2);
    const drumStep = (passBar % drumBars(state, signature)) * barSteps(signature) + stepInBar;
    showStep('drums', drumStep, time);
    const drumSolo = (Object.keys(state) as DrumInstrument[]).some(i => state[i].solo);
    const swingOffset = swingSteps(stepInBar, drumSwingRef.current, drumSwingGridRef.current) * duration * 2;
    for (const instrument of Object.keys(state) as DrumInstrument[]) {
      const track = state[instrument];
      if (track.muted || (drumSolo && !track.solo)) continue;
      const velocity = track.stepVelocities?.[drumStep] ?? 1;
      for (const offset of expandDrumStep(track, drumStep)) {
        const hitTime = time + swingOffset + offset * duration * 2;
        const early = guestInputs.leadSeconds('drums') || guestInputs.leadSeconds(`drum:${instrument}`);
        void drumAudio.playDrumHit(instrument, track.settings, velocity, hitTime - early);
        if (midiOut.active) midiOut.note(midiOut.channelOf('drums'), DRUM_NOTE_MAP[instrument], velocity, midiTime(hitTime), midiTime(hitTime + 0.06));
        if (instrument !== 'kick') continue;
        for (const synth of lanes) {
          const amount = synth.synthParams?.duck ?? 0;
          if (amount > 0) synthAudio.duck(synth.id, hitTime - guestInputs.leadSeconds(`synth:${synth.id}`), amount);
        }
      }
    }
  };
  const transportPlaying = synths.some(s => s.isPlaying);
  // How fast a tick of the transport plays (roadmap 17): the tempo of the scene it falls in, which is
  // the open scene's in scene mode and the song's scene there in song mode, or the project's for a
  // scene with none of its own. The count-in is at the tempo of the scene the music starts with.
  const tempoAt = (counted: number) => {
    // Following another device's clock, its tempo is the only one.
    if (externalTempoRef.current !== null) return externalTempoRef.current;
    const own = (sceneId: string | undefined) => (sceneId ? scenesRef.current.find(scene => scene.id === sceneId)?.tempo : undefined) ?? globalTempoRef.current;
    if (playModeRef.current !== 'song') return own(currentSceneIdRef.current);
    const tick = Math.max(0, counted - countInRef.current.ticks);
    return own(sceneAtTick(songRef.current, songStartTickRef.current + tick, sceneLengthRef.current, signatureOfRef.current)?.sceneId);
  };
  // The audio tracks' clips (docs/TIMELINE_PLAN.md), in song mode only. The first tick played starts
  // whatever is under way part through; after it, each clip starts on its own tick. Its recording
  // must be decoded already (loadRecordings, as the project opens): one that is not is skipped.
  const clipsPrimedRef = useRef(false);
  const playClips = (counted: number, time: number) => {
    const tracks = audioTracksRef.current;
    if (tracks.length === 0) { clipsPrimedRef.current = true; return; }
    const length = songLengthTicks(songRef.current, sceneLengthRef.current, signatureOfRef.current);
    if (length <= 0) return;
    const songTick = counted % length;
    const tempoOf = (sceneId: string) => scenesRef.current.find(scene => scene.id === sceneId)?.tempo;
    const secondsAt = (at: number) => songSecondsAt(songRef.current, at, sceneLengthRef.current, signatureOfRef.current, globalTempoRef.current, tempoOf);
    const cues = clipsPrimedRef.current ? clipsStarting(tracks, songTick) : clipsSounding(tracks, secondsAt(songTick), secondsAt);
    clipsPrimedRef.current = true;
    for (const cue of cues) {
      const recording = recordingNow(cue.clip.sampleId);
      if (recording) trackPlayer.play(cue.track, cue.clip, recording, time, cue.into);
    }
  };
  const startTransport = (options: { countIn?: boolean } = {}) => {
    trackPlayer.stop();
    clipsPrimedRef.current = false;
    transportRef.current ??= new BrowserTransport(
      () => engine.getContext().currentTime,
      tick => tempoAt(tick),
      tick => scheduleTickRef.current(tick),
      () => guestInputs.reachSeconds(),
    );
    const transport = transportRef.current, context = engine.getContext();
    // Guests are told where the beats fall on the computer's clock, which they share with this page.
    // A count-in is for a person about to play, never for an export that is recording the guests.
    // Music someone else in a live session started begins when they said, with their count-in.
    const remote = liveStartRef.current;
    liveStartRef.current = null;
    // Nor for music started by another device's clock, whose start is the first beat.
    const countIn = metronomeRef.current.countIn && options.countIn !== false && !exportingRef.current && !midiFollowClockRef.current ? countInBars(metronomeRef.current) : 0;
    // The count-in is a bar of the scene that plays first.
    const firstScene = playModeRef.current === 'song' ? songRef.current.entries[songStartEntryRef.current]?.sceneId : undefined;
    const counted = signatureOfRef.current(firstScene ?? currentSceneIdRef.current);
    const countInTicks = remote ? remote.countIn : countIn * barTicks(counted);
    countInRef.current = { ticks: countInTicks, signature: counted };
    barAnchorRef.current = { tick: 0, bar: 0, perBar: 0 };
    // Nothing is playing during the count-in, so no step is lit: the playhead is put before the first.
    if (countInTicks > 0) for (const lane of ['drums' as const, ...synthsRef.current.map(synth => synth.id)]) playhead.set(lane, -1);
    // Guests count their beats from where the music starts, which is after the count-in (a beat is eight ticks).
    const countedBeats = countInTicks / 8;
    transport.onTempo = (bpm, time, beat) => {
      if (beat >= countedBeats) guestLink.announce({ playing: true, bpm, anchorWall: wallAtContextTime(context, time), anchorBeat: beat - countedBeats });
    };
    // With guests connected the first beat is placed far enough ahead for all of them to make it, and
    // with someone else in a live session far enough ahead for them to hear of it. A start someone
    // else chose may be past already: the transport then skips to where the music is now.
    const announce = !remote && !exportingRef.current && Date.now() - announceRef.current < 2000;
    announceRef.current = 0;
    const lead = remote
      ? contextTimeAtWall(context, remote.wall) - context.currentTime
      : Math.max(guestLink.startLead(), announce && liveTransport.shared() ? LIVE_LEAD_SECONDS : 0);
    transport.start(lead || undefined);
    guestLink.announce({
      playing: true, bpm: globalTempoRef.current, anchorBeat: 0,
      anchorWall: wallAtContextTime(context, transport.startTime + countedBeats * 60 / Math.max(20, globalTempoRef.current)),
    });
    if (announce) liveTransport.play({ wall: wallAtContextTime(context, transport.startTime), tick: 0, mode: playModeRef.current, entry: songStartEntryRef.current, countIn: countInTicks });
  };
  const startTransportRef = useRef(startTransport);
  startTransportRef.current = startTransport;
  useEffect(() => {
    if (transportPlaying) {
      startTransportRef.current();
    } else {
      if (guestLink.transport().playing) guestLink.announce({ playing: false });
      transportRef.current?.stop();
      midiOut.stop();
      resetMidiClock();
      playhead.reset();
      synthAudio.stopAllNotes();
      // Every lane is back at its own sound: automation only plays.
      synthAudio.endAutomation();
      autoPassRef.current.clear();
      localService.holdUndo('auto', false);
      // A key still held (or latched) when the transport stops keeps the length it was given.
      endRecordedHolds();
      drumAudio.stopAllNotes();
      trackPlayer.stop();
    }
  }, [transportPlaying]);
  const playStop = useCallback(async () => {
    const currentSynths = synthsRef.current;
    const isAnyPlaying = currentSynths.some(s => s.isPlaying);
    const playableSynths = currentSynths.filter(s => s.pattern);

    if (!isAnyPlaying) {
      songEndingRef.current = false;
      songStartTickRef.current = playModeRef.current === 'song' ? entryStartTick(songRef.current, songStartEntryRef.current, sceneLengthRef.current, signatureOfRef.current) : 0;
      const readiness = await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
      ]);
      if (readiness.some(ready => !ready)) {
        setStorageError('Audio could not start. Allow audio playback and press Play again.');
        return;
      }
      // The sequencerPlay event marks each lane as playing.
      const playResults = localService.applyAll(playableSynths.map(s => ({ type: 'transport.play' as const, synthId: s.id, patternId: s.pattern!.id })));
      for (const [index, s] of playableSynths.entries()) if (playResults[index].ok) playhead.set(s.id, 0);
      return;
    }

    // A knob held where it was put is written up to here before the transport stops counting.
    endAutoPassesRef.current(true);
    const playingSynthIds = currentSynths.filter(s => s.isPlaying).map((s) => s.id);
    localService.applyAll(currentSynths.filter(s => s.isPlaying).map(s => ({ type: 'transport.stop' as const, synthId: s.id })));
    // The sequencerStop event has already turned each lane's release signal over once, and this
    // turns it over again, so the lane ends as it began. Kept as it was.
    if (playingSynthIds.length > 0) {
      setSynths(prev => prev.map(s => (
        playingSynthIds.includes(s.id)
          ? { ...s, isPlaying: false, forceReleaseSignal: !s.forceReleaseSignal }
          : s
      )));
    }
    transportRef.current?.stop();
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    setSongPosition(null);
  }, [synthAudio, drumAudio]);
  handleGlobalPlayStopRef.current = playStop;
  stopPlaybackRef.current = () => {
    if (synthsRef.current.some(s => s.isPlaying)) void playStop();
  };
  // The Play button and Space. In a live session they play and stop for everyone; anything else that
  // starts or stops the transport (an export playing through, a song ending) is this browser's alone.
  const handleGlobalPlayStop = useCallback(async () => {
    if (synthsRef.current.some(s => s.isPlaying)) {
      await playStop();
      liveTransport.stop();
      return;
    }
    if (liveTransport.playingElsewhere()) {
      // Someone else's music is playing: listen along from where it is, rather than start everyone over.
      const ready = await Promise.all([synthAudio.ensureAudioReady(), drumAudio.ensureAudioReady()]);
      if (ready.every(Boolean) && liveTransport.listen()) return;
    }
    announceRef.current = Date.now();
    await playStop();
  }, [playStop, synthAudio, drumAudio]);
  // A block or a row of the song pressed: the song starts from there next time, and if it is playing
  // it goes there now, with no count-in. In a live session everyone goes with it.
  const jumpToEntry = useCallback((entry: number) => {
    songStartEntryRef.current = entry;
    setSongStartEntry(entry);
    const transport = transportRef.current;
    if (playModeRef.current !== 'song' || !transport?.running || exportingRef.current) return;
    transport.stop();
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    songEndingRef.current = false;
    songStartTickRef.current = entryStartTick(songRef.current, entry, sceneLengthRef.current, signatureOfRef.current);
    announceRef.current = Date.now();
    startTransportRef.current({ countIn: false });
  }, [synthAudio, drumAudio]);
  // A live session's music: started here at the moment someone else chose (from where it is, if it
  // has begun), stopped when they stop it, and where it is now, for someone joining. Nothing starts
  // before this page has been touched, since a browser keeps its audio off until then.
  useEffect(() => liveTransport.connect({
    start: play => {
      if (exportingRef.current || engine.getContext().state !== 'running') return;
      const mode: PlayMode = play.mode === 'song' ? 'song' : 'pattern';
      const entry = Math.min(play.entry, Math.max(0, songRef.current.entries.length - 1));
      playModeRef.current = mode;
      setPlayMode(mode);
      songStartEntryRef.current = entry;
      setSongStartEntry(entry);
      // Where the transport's first tick falls, on this computer's clock, at the tempo now.
      liveStartRef.current = { wall: play.wall - play.tick * 60 / Math.max(20, globalTempoRef.current) / 8, countIn: play.countIn };
      if (!synthsRef.current.some(s => s.isPlaying)) { void playStop(); return; }
      // Already playing: start again from where theirs is.
      transportRef.current?.stop();
      synthAudio.stopAllNotes();
      drumAudio.stopAllNotes();
      songEndingRef.current = false;
      songStartTickRef.current = mode === 'song' ? entryStartTick(songRef.current, entry, sceneLengthRef.current, signatureOfRef.current) : 0;
      startTransportRef.current();
    },
    stop: () => { if (synthsRef.current.some(s => s.isPlaying)) void playStop(); },
    now: () => {
      const transport = transportRef.current;
      if (!transport?.running || exportingRef.current) return null;
      const context = engine.getContext(), time = context.currentTime;
      return { wall: wallAtContextTime(context, time), tick: Math.max(0, transport.ticksAt(time)), mode: playModeRef.current, entry: songStartEntryRef.current, countIn: countInRef.current.ticks };
    },
  }), [playStop, synthAudio, drumAudio]);
  return { handleGlobalPlayStop, jumpToEntry };
}
