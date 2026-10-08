import { useRef, useCallback, useEffect } from 'react';
import type { SynthParameters, EffectsLoopState } from '../types';
import { createAudioLane, getAudioContext, ensureAudioReady, loadSynthWorklet, setEffectsLoop } from './browserAudio';

export function flattenSynthParams(p: SynthParameters, bpm = 120): Record<string, unknown> {
  const syncRate = (rate: number, sync?: boolean) => sync ? Math.max(20, Math.min(300, bpm)) * 4 / (60 * Math.max(1, Math.round(rate))) : rate;
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

export function useSynthAudio() {
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const laneRef = useRef<ReturnType<typeof createAudioLane> | null>(null);
  const loadingRef = useRef<Promise<AudioWorkletNode> | null>(null);
  const paramsRef = useRef<SynthParameters | null>(null);
  const bpmRef = useRef(120);
  const volumeRef = useRef(1);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);

  const updateParameters = useCallback((params: SynthParameters, bpm = 120, loop?: EffectsLoopState) => {
    paramsRef.current = params;
    bpmRef.current = bpm;
    if (loop) setEffectsLoop(loop);
    nodeRef.current?.port.postMessage({ type: 'params', params: flattenSynthParams(params, bpm) });
    laneRef.current?.setSends(params.fxSends, params.fxReturn);
  }, []);

  async function getNode(): Promise<AudioWorkletNode> {
    if (nodeRef.current) return nodeRef.current;
    if (!loadingRef.current) {
      const generation = generationRef.current;
      loadingRef.current = loadSynthWorklet().then(() => {
        if (generation !== generationRef.current) throw new Error('Audio lane disposed');
        const ctx = getAudioContext();
        const node = new AudioWorkletNode(ctx, 'synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
        const lane = createAudioLane('synth');
        lane.setVolume(volumeRef.current);
        node.connect(lane.input);
        laneRef.current = lane;
        nodeRef.current = node;
        if (paramsRef.current) updateParameters(paramsRef.current, bpmRef.current);
        return node;
      }).finally(() => { loadingRef.current = null; });
    }
    return loadingRef.current;
  }

  const playNote = useCallback(async (
    note: string, params: SynthParameters | null, duration?: number,
    velocity = 1, muted = false, loop?: EffectsLoopState, bpm = 120,
  ) => {
    const generation = generationRef.current;
    if (muted || !await ensureAudioReady() || generation !== generationRef.current) return;
    try {
      const node = await getNode();
      if (generation !== generationRef.current) return;
      if (params) updateParameters(params, bpm, loop);
      else if (loop) setEffectsLoop(loop);
      const id = ++sequenceRef.current;
      node.port.postMessage({ type: 'noteOn', note, velocity, id, duration });
    } catch (error) { console.error('Synth playback failed:', error); }
  }, [updateParameters]);

  const stopNote = useCallback((note: string, _params?: SynthParameters | null) => {
    nodeRef.current?.port.postMessage({ type: 'noteOff', note });
  }, []);
  const stopAllNotes = useCallback((release = 0.03) => {
    generationRef.current++;
    nodeRef.current?.port.postMessage({ type: 'allNotesOff', release });
  }, []);
  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    laneRef.current?.setVolume(volumeRef.current);
  }, []);
  const dispose = useCallback(() => {
    stopAllNotes();
    const node = nodeRef.current;
    const lane = laneRef.current;
    nodeRef.current = null;
    laneRef.current = null;
    // Let a short release reach the output before disconnecting the lane.
    setTimeout(() => { node?.disconnect(); node?.port.close(); lane?.dispose(); }, 50);
  }, [stopAllNotes]);
  useEffect(() => dispose, [dispose]);
  return {
    ensureAudioReady, tryResume: () => { void ensureAudioReady(); },
    playNote, stopNote, stopAllNotes, updateParameters, setEffectsLoop, setVolume, dispose,
  };
}
