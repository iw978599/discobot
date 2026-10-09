import { useRef, useCallback, useEffect, useMemo } from 'react';
import type { SynthParameters, EffectsLoopState } from '../types';
import { toVoiceParams } from '@discobot/engine';
import { createAudioLane, getAudioContext, ensureAudioReady, loadAudioWorklet, setEffectsLoop } from './browserAudio';

interface SynthLane {
  node?: AudioWorkletNode;
  audio?: ReturnType<typeof createAudioLane>;
  loading?: Promise<AudioWorkletNode>;
  parameters?: SynthParameters;
  bpm: number;
  generation: number;
  // Note-ons still waiting on audio resume or worklet loading, keyed by note name.
  starting: Map<string, Set<number>>;
}

export function useSynthAudio() {
  const lanesRef = useRef(new Map<number, SynthLane>());
  const volumeRef = useRef(1);
  const sequenceRef = useRef(0);

  function laneFor(id: number): SynthLane {
    let lane = lanesRef.current.get(id);
    if (!lane) {
      lane = { bpm: 120, generation: 0, starting: new Map() };
      lanesRef.current.set(id, lane);
    }
    return lane;
  }
  const updateParameters = useCallback((parameters: SynthParameters, bpm = 120, loop?: EffectsLoopState, synthId = 1) => {
    const lane = laneFor(synthId);
    lane.parameters = parameters;
    lane.bpm = bpm;
    if (loop) setEffectsLoop(loop);
    lane.node?.port.postMessage({ type: 'params', params: toVoiceParams(parameters, bpm) });
    lane.audio?.setSends(parameters.fxSends, parameters.fxReturn);
  }, []);

  async function getNode(lane: SynthLane): Promise<AudioWorkletNode> {
    if (lane.node) return lane.node;
    if (!lane.loading) {
      const generation = lane.generation;
      lane.loading = loadAudioWorklet().then(() => {
        if (generation !== lane.generation) throw new Error('Audio lane stopped');
        const ctx = getAudioContext();
        const node = new AudioWorkletNode(ctx, 'synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
        const audio = createAudioLane('synth');
        audio.setVolume(volumeRef.current);
        node.connect(audio.input);
        lane.audio = audio;
        lane.node = node;
        if (lane.parameters) {
          node.port.postMessage({ type: 'params', params: toVoiceParams(lane.parameters, lane.bpm) });
          audio.setSends(lane.parameters.fxSends, lane.parameters.fxReturn);
        }
        return node;
      }).finally(() => { lane.loading = undefined; });
    }
    return lane.loading;
  }

  const playNote = useCallback(async (
    note: string, parameters: SynthParameters | null, duration?: number,
    velocity = 1, muted = false, loop?: EffectsLoopState, bpm = 120, synthId = 1, scheduledTime?: number,
  ) => {
    if (muted) return;
    const lane = laneFor(synthId), generation = lane.generation, id = ++sequenceRef.current;
    let starting = lane.starting.get(note);
    if (!starting) lane.starting.set(note, starting = new Set());
    starting.add(id);
    // A release or lane stop that arrives while this note is still starting must win.
    const cancelled = () => generation !== lane.generation || !lane.starting.get(note)?.has(id);
    try {
      if (!await ensureAudioReady() || cancelled()) return;
      if (parameters) updateParameters(parameters, bpm, loop, synthId);
      else if (loop) setEffectsLoop(loop);
      const node = await getNode(lane);
      if (cancelled()) return;
      node.port.postMessage({ type: 'noteOn', note, velocity, id, duration, time: scheduledTime });
    } catch (error) {
      if (generation === lane.generation) console.error('Synth playback failed:', error);
    } finally {
      const remaining = lane.starting.get(note);
      remaining?.delete(id);
      if (remaining?.size === 0) lane.starting.delete(note);
    }
  }, [updateParameters]);

  const stopNote = useCallback((note: string, _parameters?: SynthParameters | null, synthId = 1) => {
    const lane = lanesRef.current.get(synthId);
    if (!lane) return;
    lane.starting.delete(note);
    lane.node?.port.postMessage({ type: 'noteOff', note });
  }, []);
  const stopSynth = useCallback((synthId: number, release = 0.03) => {
    const lane = lanesRef.current.get(synthId);
    if (!lane) return;
    lane.generation++;
    lane.starting.clear();
    lane.node?.port.postMessage({ type: 'allNotesOff', release });
  }, []);
  const stopAllNotes = useCallback((release = 0.03) => {
    lanesRef.current.forEach((_lane, id) => stopSynth(id, release));
  }, [stopSynth]);
  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    lanesRef.current.forEach(lane => lane.audio?.setVolume(volumeRef.current));
  }, []);
  const dispose = useCallback(() => {
    stopAllNotes();
    const previous = [...lanesRef.current.values()];
    lanesRef.current.clear();
    setTimeout(() => previous.forEach(lane => {
      lane.node?.disconnect(); lane.node?.port.close(); lane.audio?.dispose();
    }), 50);
  }, [stopAllNotes]);
  useEffect(() => dispose, [dispose]);
  // The same object on every render, so effects and callbacks that depend on it do not re-run.
  return useMemo(() => ({
    ensureAudioReady, tryResume: () => { void ensureAudioReady(); },
    playNote, stopNote, stopSynth, stopAllNotes, updateParameters, setEffectsLoop, setVolume, dispose,
  }), [playNote, stopNote, stopSynth, stopAllNotes, updateParameters, setVolume, dispose]);
}
