// Notes played and recorded: from the on-screen keys, the computer keyboard and MIDI devices,
// with the arpeggiator, record timing, held lengths, Learn, pads and each device's place. Split out
// of useStudio.tsx.
import { useCallback, useEffect, useRef } from 'react';
import { liveJam } from '../services/liveSession';
import { MidiMessage, MidiSource } from '../hooks/useMidiInput';
import { localService } from '../services/localService';
import { barTicks, stepsPerBar } from '../services/patternLength';
import { playhead } from '../services/playhead';
import { stepNotes, withStepLength, withStepNotes } from '../services/noteScheduling';
import { drumForNote, storePads, withPad } from '../services/midiDrums';
import { destinationFor, destinationLane, storeMidiDestinations, withDestination, type MidiDestination } from '../services/midiDevices';
import { recordPosition } from '../services/recordTiming';
import { storeMidiTies, tieFor, withTie } from '../services/midiTies';
import { type LiveArpLane } from '../services/liveArp';
import { useComputerKeyboard } from '../hooks/useComputerKeyboard';
import { CHORD_WINDOW_MS, midiNoteToName } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioNotesNeeds {
  arpLane: (synthId: number) => LiveArpLane;
  handleOctaveShift: (synthId: number, direction: "up" | "down") => void;
}

export function useStudioNotes(core: StudioCore, needs: StudioNotesNeeds) {
  const { engine, synthsRef, setSynths, quantizeRef, transportRef, signatureOfRef, currentSceneIdRef, recordHeldRef, midiChordRef, recordingRef, synthAudio, liveArpRef, browserMutedRef, effectsLoopRef, globalTempo, synths, selectedSynthId, liveLanesRef, midiHeldRef, midiDestinationsRef, setMidiDestinations, midiChannelRef, midiTargetSynthIdRef, selectedSynthIdRef, midiLearnRef, setMidiTies, setMidiLearn, midiTiesRef, applyParamTargetRef, midiPadLearnRef, midiPadsRef, setMidiPads, setMidiPadLearn, midiDrumChannelRef, drumStateRef, drumAudio, midiModeRef, globalTempoRef } = core;
  const { arpLane, handleOctaveShift } = needs;
  // Writes a note to a step. `add` joins it to the chord already there instead of replacing it.
  const upsertStepNote = useCallback(async (synthId: number, stepIndex: number, note: string, velocity: number, add = false, offset?: number, select = true) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const boundedVelocity = Math.max(0, Math.min(1, velocity));
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => (
        idx === stepIndex
          // A recorded note brings how late it was played; a note joining a chord starts where the chord does.
          ? withStepNotes({ ...step, velocity: boundedVelocity, ...(offset !== undefined && !add ? { offset } : {}) }, add ? [...stepNotes(step), note] : [note])
          : step
      )),
    };

    // A note put on a chosen step selects it and moves the step pointer on. A recorded note does
    // neither: left selected, its step would take the next key played and lose what was recorded.
    if (select) setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextPointer = (stepIndex + 1) % updatedPattern.steps.length;
      return { ...s, selectedStep: stepIndex, stepRecordPointer: nextPointer };
    }));
    // The next note's undo entry holds this one, as with a painted cell.
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);
  // Where a note played now on this lane is recorded: the step the player is hearing, moved
  // towards the nearest step by the quantize strength. Null when the transport is not running, or
  // is still counting in.
  const recordedStep = useCallback((synthId: number, strength = quantizeRef.current): { step: number; offset: number } | null => {
    const transport = transportRef.current;
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (!transport?.running || !pattern || pattern.steps.length === 0 || playhead.get(synthId) < 0) return null;
    const context = engine.getContext();
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const perBar = stepsPerBar(pattern.steps.length, pattern.bars, signature);
    return recordPosition({
      // What is heard now left the clock a moment ago.
      heardTicks: transport.ticksAt(context.currentTime - (context.outputLatency || 0)),
      scheduledTicks: transport.scheduledTicks, playheadStep: playhead.get(synthId),
      ticksPerStep: barTicks(signature) / perBar, steps: pattern.steps.length, strength,
    });
  }, []);
  // Where the player is on the transport's clock, in ticks, and how many ticks a step of a lane is.
  const heardTicks = (): number | null => {
    const transport = transportRef.current;
    if (!transport) return null;
    const context = engine.getContext();
    return transport.ticksAt(context.currentTime - (context.outputLatency || 0));
  };
  const ticksPerStepOf = (synthId: number): number | null => {
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (!pattern || pattern.steps.length === 0) return null;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    return barTicks(signature) / stepsPerBar(pattern.steps.length, pattern.bars, signature);
  };
  const endRecordedHold = (synthId: number, note: string, write: boolean) => {
    const key = `${synthId}
${note}`, held = recordHeldRef.current.get(key);
    if (!held) return;
    recordHeldRef.current.delete(key);
    const now = heardTicks(), each = ticksPerStepOf(synthId), synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern, step = pattern?.steps[held.step];
    if (write && now !== null && each && pattern && step && stepNotes(step).includes(note)) {
      const length = Math.min(pattern.steps.length - held.step, Math.max(1, Math.round((now - held.ticks) / each)));
      if (length !== (step.length ?? 1)) {
        localService.writePattern(synthId, pattern.id, { ...pattern, steps: pattern.steps.map((entry, index) => (index === held.step ? withStepLength(entry, length, note) : entry)) });
      }
    }
    if (![...recordHeldRef.current.values()].some(entry => entry.synthId === synthId)) localService.holdUndo(`record:${synthId}`, false);
  };
  const endRecordedHolds = () => { for (const held of [...recordHeldRef.current.values()]) endRecordedHold(held.synthId, held.note, true); };
  // A note recorded from the keys: one played with another, within a moment, joins its chord.
  const recordNote = useCallback((synthId: number, note: string, velocity: number): boolean => {
    const now = performance.now(), chord = midiChordRef.current;
    const joins = chord !== null && chord.synthId === synthId && now - chord.at < CHORD_WINDOW_MS;
    const at = joins ? { step: chord.stepIndex, offset: 0 } : recordedStep(synthId);
    if (!at) return false;
    const ticks = heardTicks();
    if (ticks !== null) {
      localService.holdUndo(`record:${synthId}`, true);
      recordHeldRef.current.set(`${synthId}
${note}`, { synthId, note, step: at.step, ticks });
    }
    midiChordRef.current = { synthId, stepIndex: at.step, at: now };
    void upsertStepNote(synthId, at.step, note, velocity, joins, at.offset, false);
    return true;
  }, [recordedStep, upsertStepNote]);
  const handleNotePlay = useCallback(async (synthId: number, note: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.synthParams) return;
    if (synth.muted || (synthsRef.current.some(s => s.solo) && !synth.solo)) return;
    liveJam.send({ kind: 'note', lane: synthId, note, velocity: 1, on: true });
    // Recording: the note goes where it was played in the bar, not on the selected step. It is
    // taken before the sound starts, so starting audio cannot make it late.
    const recorded = recordingRef.current && synth.isPlaying && recordNote(synthId, note, 1);

    await synthAudio.ensureAudioReady();
    if (synth.synthParams.arpeggiator.enabled) {
      liveArpRef.current!.press(synthId, note, 1, arpLane(synthId));
    } else {
      await synthAudio.playNote(note, synth.synthParams, undefined, 1, browserMutedRef.current, effectsLoopRef.current, globalTempo, synthId);
    }

    // Starting audio can take a moment the first time; use the pattern as it is now, not as it
    // was when the key went down, or a quick second note would undo the first.
    const step = synth.selectedStep;
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (recorded || step === null || !pattern) return;

    const updated = {
      ...pattern,
      steps: pattern.steps.map((s, i) => i === step ? { ...s, note, active: true } : s),
    };

    localService.writePattern(synthId, pattern.id, updated);
  }, [synthAudio, globalTempo, recordNote]);
  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    endRecordedHold(synthId, note, true);
    liveJam.send({ kind: 'note', lane: synthId, note, velocity: 0, on: false });
    liveArpRef.current!.release(synthId, note);
    synthAudio.stopNote(note, synthParams, synthId);
  }, [synthAudio]);
  const keyboardSynth = synths.find(s => s.id === selectedSynthId);
  const computerKeyNotes = useComputerKeyboard({
    target: keyboardSynth
      ? { synthId: keyboardSynth.id, octaveShift: keyboardSynth.octaveShift, hold: Boolean(keyboardSynth.synthParams?.hold) }
      : null,
    resetKey: keyboardSynth
      ? `${keyboardSynth.id}:${keyboardSynth.octaveShift}:${keyboardSynth.forceReleaseSignal}:${Boolean(keyboardSynth.synthParams?.hold)}`
      : '',
    onNoteDown: (synthId, note) => { void handleNotePlay(synthId, note); },
    onNoteUp: (synthId, note) => { void handleNoteRelease(synthId, note); },
    onOctave: handleOctaveShift,
  });
  const releaseLiveGestures = useCallback((device: string) => {
    const synthId = liveLanesRef.current.get(device);
    if (synthId === undefined) return;
    liveLanesRef.current.delete(device);
    synthAudio.setLive(synthId, { bend: 0, wheel: 0 });
  }, [synthAudio]);
  const handleMidiDestinationChange = useCallback((device: string, place: MidiDestination) => {
    releaseLiveGestures(device);
    midiHeldRef.current.forEach((held, key) => {
      if (held.device !== device) return;
      midiHeldRef.current.delete(key);
      void handleNoteRelease(held.synthId, held.note);
    });
    const next = withDestination(midiDestinationsRef.current, device, place);
    midiDestinationsRef.current = next;
    storeMidiDestinations(next);
    setMidiDestinations(next);
  }, [handleNoteRelease, releaseLiveGestures]);
  const handleMidiMessage = useCallback((message: MidiMessage, source: MidiSource) => {
    if (message.type === 'noteOff') {
      // Release on the lane that took the note-on, even if the channel, the target or the device's
      // place changed since. A pad's note-off means nothing: no lane holds it.
      const heldKey = `${source.id}\n${message.channel}:${message.note}`;
      const held = midiHeldRef.current.get(heldKey);
      if (!held) return;
      midiHeldRef.current.delete(heldKey);
      void handleNoteRelease(held.synthId, held.note);
      return;
    }
    if (message.type === 'deviceGone') { releaseLiveGestures(source.name); return; }
    const place = destinationFor(midiDestinationsRef.current, source.name);
    if (place === 'off') return;
    // The lane a device's notes would go to, for its pitch bend and mod wheel; the drums and a lane the project lacks have none.
    const liveLane = (): number | null => {
      if (place === 'drums') return null;
      if (place === 'default') {
        if (message.channel !== midiChannelRef.current) return null;
        return (synthsRef.current.find(s => s.id === midiTargetSynthIdRef.current) ?? synthsRef.current[0])?.id ?? null;
      }
      return synthsRef.current.find(s => s.id === (place === 'open' ? selectedSynthIdRef.current : destinationLane(place)))?.id ?? null;
    };
    const gesture = (live: { bend?: number; wheel?: number }) => {
      const synthId = liveLane();
      if (synthId === null) return;
      const before = liveLanesRef.current.get(source.name);
      if (before !== undefined && before !== synthId) synthAudio.setLive(before, { bend: 0, wheel: 0 });
      liveLanesRef.current.set(source.name, synthId);
      synthAudio.setLive(synthId, live);
    };
    if (message.type === 'pitchBend') { gesture({ bend: message.value }); return; }
    if (message.type === 'controlChange') {
      // A knob on the controller. While a parameter is waiting to be learned, the first knob turned
      // is tied to it; otherwise a knob that is tied moves its parameter.
      const waiting = midiLearnRef.current;
      if (waiting) {
        setMidiTies(current => { const next = withTie(current, { channel: message.channel, controller: message.controller, target: waiting }); storeMidiTies(next); return next; });
        setMidiLearn(null);
        return;
      }
      const tie = tieFor(midiTiesRef.current, message.channel, message.controller);
      if (tie) applyParamTargetRef.current(tie.target, message.value / 127);
      else if (message.controller === 1) gesture({ wheel: message.value / 127 });
      return;
    }
    // While a drum is waiting to be learned, the first note played is its pad's from then on.
    const waitingPad = midiPadLearnRef.current;
    if (waitingPad) {
      const next = withPad(midiPadsRef.current, waitingPad, message.note);
      midiPadsRef.current = next;
      midiPadLearnRef.current = null;
      storePads(next);
      setMidiPads(next);
      setMidiPadLearn(null);
      return;
    }
    // A pad is a note on the drum channel, or any note from a device sent to the drums: it plays
    // its drum, and while recording it is written on the step being played. A note that is no drum
    // here does nothing. If the keyboard's channel is the drum channel too, the lane keeps it, as
    // it always had it.
    if (place === 'drums' || (place === 'default' && message.channel === midiDrumChannelRef.current && message.channel !== midiChannelRef.current)) {
      const instrument = drumForNote(message.note, midiPadsRef.current);
      const drums = drumStateRef.current;
      if (!instrument || !drums[instrument]) return;
      const velocity = Math.max(0.05, message.velocity / 127);
      liveJam.send({ kind: 'hit', drum: instrument, velocity });
      const silenced = drums[instrument].muted || (Object.values(drums).some(track => track.solo) && !drums[instrument].solo);
      if (!silenced) void drumAudio.playDrumHit(instrument, drums[instrument].settings, velocity);
      const transport = transportRef.current;
      if (midiModeRef.current === 'record' && transport?.running && playhead.get('drums') >= 0) {
        // On the step the player is hearing, as a recorded note is: the scheduler is ahead of that.
        const context = engine.getContext();
        const { step } = recordPosition({
          heardTicks: transport.ticksAt(context.currentTime - (context.outputLatency || 0)), scheduledTicks: transport.scheduledTicks,
          playheadStep: playhead.get('drums'), ticksPerStep: 2, steps: drums[instrument].steps.length, strength: 1,
        });
        localService.applyAll([
          { type: 'drum.step', instrument, step, active: true },
          { type: 'drum.stepVelocity', instrument, step, velocity },
        ]);
      }
      return;
    }
    const noteName = midiNoteToName(message.note);
    // A device with a lane of its own plays it on every channel. A lane the project does not have
    // plays nothing.
    if (place === 'default' && message.channel !== midiChannelRef.current) return;

    const synthSnapshot = synthsRef.current;
    const targetSynth = place === 'default'
      ? synthSnapshot.find(s => s.id === midiTargetSynthIdRef.current) ?? synthSnapshot[0]
      : synthSnapshot.find(s => s.id === (place === 'open' ? selectedSynthIdRef.current : destinationLane(place)));
    if (!targetSynth) return;
    if (targetSynth.muted || (synthSnapshot.some(s => s.solo) && !targetSynth.solo)) return;

    const velocity = message.velocity / 127;
    const mode = midiModeRef.current;

    if (mode === 'live') {
      if (!targetSynth.synthParams) return;
      // Held under the device's key whether or not it is arpeggiated, so its note-off finds the lane.
      midiHeldRef.current.set(`${source.id}\n${message.channel}:${message.note}`, { synthId: targetSynth.id, note: noteName, device: source.name });
      liveJam.send({ kind: 'note', lane: targetSynth.id, note: noteName, velocity, on: true });
      if (targetSynth.synthParams.arpeggiator.enabled) {
        liveArpRef.current!.press(targetSynth.id, noteName, velocity, arpLane(targetSynth.id));
      } else {
        void synthAudio.playNote(noteName, targetSynth.synthParams, undefined, velocity, browserMutedRef.current, effectsLoopRef.current, globalTempo, targetSynth.id);
      }
      return;
    }

    const pattern = targetSynth.pattern;
    if (!pattern || pattern.steps.length === 0) return;

    if (mode === 'record') {
      // Written where it was played in the bar, moved to the nearest step by the quantize strength.
      if (targetSynth.isPlaying) recordNote(targetSynth.id, noteName, velocity);
      return;
    }
    // Keys pressed together are a chord: they go on the step the first of them landed on.
    const now = performance.now(), chord = midiChordRef.current;
    const joins = chord !== null && chord.synthId === targetSynth.id && now - chord.at < CHORD_WINDOW_MS;
    const stepIndex = joins ? chord.stepIndex : targetSynth.stepRecordPointer % pattern.steps.length;
    midiChordRef.current = { synthId: targetSynth.id, stepIndex, at: now };
    void upsertStepNote(targetSynth.id, stepIndex, noteName, velocity, joins);
  }, [handleNoteRelease, releaseLiveGestures, upsertStepNote, globalTempo, synthAudio, recordNote, drumAudio]);
  // Someone else in a live session played a note or hit a drum: it is heard here on the same lane,
  // with this browser's own sound, mutes and arpeggiator, and is never recorded or sent on. With
  // snap on and the music playing it starts on the next step here, which hides how long it took to
  // arrive, and its release waits as long, so the note keeps its length. Nothing plays before this
  // page's audio is on.
  const jamHeldRef = useRef(new Map<string, number>());
  useEffect(() => liveJam.connect(played => {
    const context = engine.getContext();
    if (context.state !== 'running') return;
    const transport = transportRef.current;
    let wait = 0;
    if (liveJam.snap() && transport?.running) {
      // A step is two ticks of the transport.
      const ticks = transport.ticksAt(context.currentTime);
      wait = (Math.ceil(ticks / 2) * 2 - ticks) * 60 / Math.max(20, globalTempoRef.current) / 8;
    }
    if (played.kind === 'hit') {
      const drums = drumStateRef.current, track = drums[played.drum];
      if (!track || track.muted || (Object.values(drums).some(entry => entry.solo) && !track.solo)) return;
      void drumAudio.playDrumHit(played.drum, track.settings, Math.max(0.05, played.velocity), context.currentTime + wait);
      return;
    }
    const key = `${played.by}:${played.lane}:${played.note}`;
    const lane = synthsRef.current.find(entry => entry.id === played.lane);
    if (!played.on) {
      const held = jamHeldRef.current.get(key);
      if (held === undefined) return;
      jamHeldRef.current.delete(key);
      const release = () => {
        liveArpRef.current!.release(played.lane, played.note);
        synthAudio.stopNote(played.note, lane?.synthParams, played.lane);
      };
      if (held > 0) setTimeout(release, held * 1000); else release();
      return;
    }
    if (!lane?.synthParams || lane.muted || (synthsRef.current.some(entry => entry.solo) && !lane.solo)) return;
    jamHeldRef.current.set(key, wait);
    if (lane.synthParams.arpeggiator.enabled) {
      const press = () => liveArpRef.current!.press(lane.id, played.note, played.velocity, arpLane(lane.id));
      if (wait > 0) setTimeout(press, wait * 1000); else press();
    } else {
      void synthAudio.playNote(played.note, lane.synthParams, undefined, played.velocity, browserMutedRef.current, effectsLoopRef.current, globalTempoRef.current, lane.id, wait > 0 ? context.currentTime + wait : undefined);
    }
  }), [synthAudio, drumAudio]);
  return { recordedStep, endRecordedHolds, handleNotePlay, handleNoteRelease, computerKeyNotes, handleMidiDestinationChange, handleMidiMessage };
}
