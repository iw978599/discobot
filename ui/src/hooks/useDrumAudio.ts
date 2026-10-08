import { useRef, useEffect } from 'react';
import type { DrumInstrument, DrumSettings, DrumKitId, FxSendLevels } from '../types';
import { DrumSynthesizer } from '@discobot/engine';
import { createAudioLane, getAudioContext, ensureAudioReady, setEffectsLoop } from './browserAudio';
import { DRUM_KITS } from '../services/drumKits';

export function useDrumAudio() {
  const laneRef = useRef<ReturnType<typeof createAudioLane> | null>(null);
  const volumeRef = useRef(1);
  const sendsRef = useRef<FxSendLevels>({ reverb: 0, delay: 0, drive: 0, phaser: 0 });
  const returnRef = useRef(1);
  const kitRef = useRef<DrumKitId>('clean-analog');
  const sourcesRef = useRef(new Map<AudioBufferSourceNode, GainNode>());
  const openHatRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const generationRef = useRef(0);

  function getLane() {
    if (!laneRef.current) {
      laneRef.current = createAudioLane('drums');
      laneRef.current.setVolume(volumeRef.current);
      laneRef.current.setSends(sendsRef.current, returnRef.current);
    }
    return laneRef.current;
  }
  function setVolume(value: number) { volumeRef.current = value; laneRef.current?.setVolume(value); }
  function setFxSends(sends: FxSendLevels, fxReturn = 1) {
    sendsRef.current = sends; returnRef.current = fxReturn;
    laneRef.current?.setSends(sends, fxReturn);
  }
  function setKit(kit: DrumKitId) { kitRef.current = kit; }

  async function playDrumHit(instrument: DrumInstrument, settings: DrumSettings, mutedOrVelocity: boolean | number = false, scheduledTime?: number) {
    if (mutedOrVelocity === true) return;
    const generation = generationRef.current;
    if (!await ensureAudioReady() || generation !== generationRef.current) return;
    const velocity = typeof mutedOrVelocity === 'number' ? mutedOrVelocity : 1;
    const ctx = getAudioContext();
    const time = Number.isFinite(scheduledTime) ? Math.max(ctx.currentTime, scheduledTime!) : ctx.currentTime;
    const variant = DRUM_KITS.find(kit => kit.id === kitRef.current)?.modelVariant ?? 'analog';
    const pcm = DrumSynthesizer.renderHit(instrument, settings, ctx.sampleRate, { velocity, modelVariant: variant });
    if (!pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.getChannelData(0).set(pcm);
    const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    source.buffer = buffer;
    pan.pan.value = Number.isFinite(settings.pan) ? Math.max(-1, Math.min(1, settings.pan!)) : 0;
    source.connect(gain).connect(pan).connect(getLane().input);
    if ((instrument === 'closedHH' || instrument === 'openHH') && openHatRef.current) {
      const previous = openHatRef.current;
      previous.gain.gain.setTargetAtTime(0, time, 0.003);
      previous.source.stop(time + 0.02);
    }
    if (instrument === 'openHH') openHatRef.current = { source, gain };
    sourcesRef.current.set(source, gain);
    source.onended = () => {
      sourcesRef.current.delete(source);
      if (openHatRef.current?.source === source) openHatRef.current = null;
      source.disconnect(); gain.disconnect(); pan.disconnect();
    };
    source.start(time);
  }
  function stopAllNotes() {
    generationRef.current++;
    if (sourcesRef.current.size) {
      const ctx = getAudioContext();
      sourcesRef.current.forEach((gain, source) => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.003);
        try { source.stop(ctx.currentTime + 0.02); } catch { /* already ended */ }
      });
    }
    sourcesRef.current.clear();
    openHatRef.current = null;
  }
  function dispose() {
    stopAllNotes();
    const previous = laneRef.current;
    setTimeout(() => previous?.dispose(), 30);
    laneRef.current = null;
  }
  useEffect(() => dispose, []);
  return { ensureAudioReady, tryResume: () => { void ensureAudioReady(); }, playDrumHit, setVolume, setFxSends, setKit, setEffectsLoop, stopAllNotes, dispose };
}
