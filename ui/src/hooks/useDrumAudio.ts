import { useRef, useEffect, useMemo } from 'react';
import type { DrumInstrument, DrumSettings, DrumKitId, FxSendLevels } from '../types';
import type { DrumRecordings, DrumSample } from '../../../engine/src/drums/DrumCore';
import type { DrumWorkletMessage } from '@discobot/engine';
import { createAudioLane, getAudioContext, ensureAudioReady, loadAudioWorklet, setEffectsLoop } from './browserAudio';

const send = (node: AudioWorkletNode | null, message: DrumWorkletMessage) => node?.port.postMessage(message);
// The effects each drum has a send of its own to, in the order the drum processor's extra outputs are in.
const DRUM_SEND_MIXES = ['delay', 'reverb'] as const;

export function useDrumAudio() {
  const laneRef = useRef<ReturnType<typeof createAudioLane> | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const loadingRef = useRef<Promise<AudioWorkletNode> | null>(null);
  const volumeRef = useRef(1);
  const sendsRef = useRef<FxSendLevels>({ reverb: 0, delay: 0, drive: 0, phaser: 0 });
  const returnRef = useRef(1);
  const kitRef = useRef<DrumKitId>('clean-analog');
  const generationRef = useRef(0);
  const samplesRef = useRef<Partial<Record<DrumInstrument, DrumSample>>>({});
  const cymbalsRef = useRef<DrumRecordings>({});

  // Everything below only reads refs, so one instance serves every render.
  const api = useMemo(() => {
    function getNode(): Promise<AudioWorkletNode> {
      if (nodeRef.current) return Promise.resolve(nodeRef.current);
      loadingRef.current ??= loadAudioWorklet().then(() => {
        // Three outputs: the kit, then what each drum sends to the delay and to the reverb. The lane
        // takes its delay and reverb sends from those two and its other sends from the kit.
        const node = new AudioWorkletNode(getAudioContext(), 'drum-processor', { numberOfOutputs: 3, outputChannelCount: [2, 2, 2] });
        const lane = createAudioLane('drums', DRUM_SEND_MIXES);
        lane.setVolume(volumeRef.current);
        lane.setSends(sendsRef.current, returnRef.current);
        node.connect(lane.input, 0);
        DRUM_SEND_MIXES.forEach((name, index) => node.connect(lane.taps[name]!, index + 1));
        send(node, { type: 'cymbals', cymbals: cymbalsRef.current });
        // Samples chosen before the node existed.
        for (const [instrument, sample] of Object.entries(samplesRef.current)) send(node, { type: 'sample', instrument: instrument as DrumInstrument, sample });
        laneRef.current = lane;
        nodeRef.current = node;
        return node;
      }).finally(() => { loadingRef.current = null; });
      return loadingRef.current;
    }
    function setVolume(value: number) { volumeRef.current = value; laneRef.current?.setVolume(value); }
    function setFxSends(sends: FxSendLevels, fxReturn = 1) {
      sendsRef.current = sends; returnRef.current = fxReturn;
      laneRef.current?.setSends(sends, fxReturn);
    }
    function setKit(kit: DrumKitId) { kitRef.current = kit; }
    // The recordings the cymbal lane plays. The worklet gets its own copy.
    function setCymbals(cymbals: DrumRecordings) {
      cymbalsRef.current = cymbals;
      send(nodeRef.current, { type: 'cymbals', cymbals });
    }
    // A lane's sample, or null for its synthesized voice. The worklet gets its own copy.
    function setSample(instrument: DrumInstrument, sample: DrumSample | null) {
      if (sample) samplesRef.current[instrument] = sample; else delete samplesRef.current[instrument];
      send(nodeRef.current, { type: 'sample', instrument, sample });
    }

    async function playDrumHit(instrument: DrumInstrument, settings: DrumSettings, mutedOrVelocity: boolean | number = false, scheduledTime?: number) {
      if (mutedOrVelocity === true) return;
      const generation = generationRef.current;
      try {
        if (!await ensureAudioReady()) return;
        const node = await getNode();
        // A stop that arrived while the hit was still starting wins.
        if (generation !== generationRef.current) return;
        send(node, {
          type: 'hit', instrument, settings, kitId: kitRef.current,
          velocity: typeof mutedOrVelocity === 'number' ? mutedOrVelocity : 1,
          time: Number.isFinite(scheduledTime) ? scheduledTime : undefined,
        });
      } catch (error) {
        console.error('Drum playback failed:', error);
      }
    }
    function stopAllNotes() {
      generationRef.current++;
      send(nodeRef.current, { type: 'stopAll' });
    }
    function dispose() {
      stopAllNotes();
      const lane = laneRef.current, node = nodeRef.current;
      setTimeout(() => { node?.disconnect(); node?.port.close(); lane?.dispose(); }, 30);
      laneRef.current = null;
      nodeRef.current = null;
    }
    return { ensureAudioReady, tryResume: () => { void ensureAudioReady(); }, playDrumHit, setVolume, setFxSends, setKit, setSample, setCymbals, setEffectsLoop, stopAllNotes, dispose };
  }, []);
  useEffect(() => api.dispose, [api]);
  return api;
}
