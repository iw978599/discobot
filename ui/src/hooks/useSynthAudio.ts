import { useRef, useCallback, useEffect } from 'react';
import type { SynthParameters, EffectsLoopState } from '../types';
import { createAudioLane, getAudioContext, ensureAudioReady, loadSynthWorklet, setEffectsLoop } from './browserAudio';

export function flattenSynthParams(p: SynthParameters, bpm = 120): Record<string, unknown> {
  const syncRate = (rate: number, sync?: boolean) => sync ? Math.max(20, Math.min(300, bpm)) * Math.max(1, Math.round(rate)) / 240 : rate;
  return {
    oscType: p.oscillator.type, detune: p.oscillator.detune,
    filterFreq: p.filter.frequency, filterQ: p.filter.q, filterType: p.filter.type,
    attack: p.envelope.attack, decay: p.envelope.decay, sustain: p.envelope.sustain,
    release: p.envelope.release, gain: p.gain, pan: p.pan ?? 0, spread: p.spread ?? 0,
    portamentoEnabled: p.portamento?.enabled ?? false, portamentoGlide: p.portamento?.glide ?? 0,
    lfo1Enabled: p.lfo1.enabled, lfo1Target: p.lfo1.target, lfo1Waveform: p.lfo1.waveform,
    lfo1Rate: syncRate(p.lfo1.rate, p.lfo1.sync), lfo1Depth: p.lfo1.depth,
    lfo2Enabled: p.lfo2.enabled, lfo2Target: p.lfo2.target, lfo2Waveform: p.lfo2.waveform,
    lfo2Rate: syncRate(p.lfo2.rate, p.lfo2.sync), lfo2Depth: p.lfo2.depth,
  };
}

interface SynthLane {
  node?: AudioWorkletNode;
  audio?: ReturnType<typeof createAudioLane>;
  loading?: Promise<AudioWorkletNode>;
  parameters?: SynthParameters;
  bpm: number;
  generation: number;
  pendingNoteOffs: Set<string>;
}

export function useSynthAudio() {
  const lanesRef = useRef(new Map<number, SynthLane>());
  const volumeRef = useRef(1);
  const sequenceRef = useRef(0);

  function laneFor(id: number): SynthLane {
    let lane = lanesRef.current.get(id);
    if (!lane) {
      lane = { bpm: 120, generation: 0, pendingNoteOffs: new Set() };
      lanesRef.current.set(id, lane);
    }
    return lane;
  }
  const updateParameters = useCallback((parameters: SynthParameters, bpm = 120, loop?: EffectsLoopState, synthId = 1) => {
    const lane = laneFor(synthId);
    lane.parameters = parameters;
    lane.bpm = bpm;
    if (loop) setEffectsLoop(loop);
    lane.node?.port.postMessage({ type: 'params', params: flattenSynthParams(parameters, bpm) });
    lane.audio?.setSends(parameters.fxSends, parameters.fxReturn);
  }, []);

  async function getNode(lane: SynthLane): Promise<AudioWorkletNode> {
    if (lane.node) return lane.node;
    if (!lane.loading) {
      const generation = lane.generation;
      lane.loading = loadSynthWorklet().then(() => {
        if (generation !== lane.generation) throw new Error('Audio lane stopped');
        const ctx = getAudioContext();
        const node = new AudioWorkletNode(ctx, 'synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
        const audio = createAudioLane('synth');
        audio.setVolume(volumeRef.current);
        node.connect(audio.input);
        lane.audio = audio;
        lane.node = node;
        if (lane.parameters) {
          node.port.postMessage({ type: 'params', params: flattenSynthParams(lane.parameters, lane.bpm) });
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
    const lane = laneFor(synthId), generation = lane.generation;
    if (muted || !await ensureAudioReady() || generation !== lane.generation) return;
    try {
      if (parameters) updateParameters(parameters, bpm, loop, synthId);
      else if (loop) setEffectsLoop(loop);
      const node = await getNode(lane);
      if (generation !== lane.generation) return;
      node.port.postMessage({ type: 'noteOn', note, velocity, id: ++sequenceRef.current, duration, time: scheduledTime });
      if (lane.pendingNoteOffs.delete(note)) {
        node.port.postMessage({ type: 'noteOff', note });
      }
    } catch (error) {
      if (generation === lane.generation) console.error('Synth playback failed:', error);
    }
  }, [updateParameters]);

  const stopNote = useCallback((note: string, _parameters?: SynthParameters | null, synthId = 1) => {
    const lane = lanesRef.current.get(synthId);
    if (!lane) return;
    if (lane.node) lane.node.port.postMessage({ type: 'noteOff', note });
    else lane.pendingNoteOffs.add(note);
  }, []);
  const stopSynth = useCallback((synthId: number, release = 0.03) => {
    const lane = lanesRef.current.get(synthId);
    if (!lane) return;
    lane.generation++;
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
  return {
    ensureAudioReady, tryResume: () => { void ensureAudioReady(); },
    playNote, stopNote, stopSynth, stopAllNotes, updateParameters, setEffectsLoop, setVolume, dispose,
  };
}
