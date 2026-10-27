import { useRef, useEffect, useMemo } from 'react';
import type { DrumRow, DrumSettings, DrumKitId, EffectsLoopState, FxSendLevels } from '../types';
import type { DrumRecordings, DrumSample } from '../../../engine/src/drums/DrumCore';
import type { DrumWorkletMessage } from '@discobot/engine';
import { audioEngine, type AudioEngine } from './browserAudio';

const send = (node: AudioWorkletNode | null, message: DrumWorkletMessage) => node?.port.postMessage(message);
// The effects each drum has a send of its own to, in the order the drum processor's extra outputs are in.
const DRUM_SEND_MIXES = ['delay', 'reverb'] as const;

// One drum processor and the lane it plays into. The kit is one; a drum handed to a guest on its
// own (services/guestInput) has another, which plays that drum alone, so it can go to the guest
// while the rest of the kit stays in the mix.
interface Player {
  node: AudioWorkletNode | null;
  lane: ReturnType<AudioEngine['createLane']> | null;
  loading: Promise<AudioWorkletNode> | null;
  handedTo: AudioNode | null;
}
type PlayerKey = 'kit' | DrumRow;

// `engine` is the app's unless another is given (a test's, say).
export function useDrumAudio(engine: AudioEngine = audioEngine) {
  const playersRef = useRef(new Map<PlayerKey, Player>());
  const volumeRef = useRef(1);
  const sendsRef = useRef<FxSendLevels>({ reverb: 0, delay: 0, drive: 0, phaser: 0 });
  const returnRef = useRef(1);
  const kitRef = useRef<DrumKitId>('clean-analog');
  const generationRef = useRef(0);
  const samplesRef = useRef<Partial<Record<DrumRow, DrumSample>>>({});
  const cymbalsRef = useRef<DrumRecordings>({});
  // The drums handed to a guest on their own: their hits go to a player of their own.
  const ownPlayersRef = useRef(new Set<DrumRow>());

  // Everything below only reads refs, so one instance serves every render.
  const api = useMemo(() => {
    const players = playersRef.current;
    const playerFor = (key: PlayerKey): Player => {
      let player = players.get(key);
      if (!player) { player = { node: null, lane: null, loading: null, handedTo: null }; players.set(key, player); }
      return player;
    };
    const nodes = () => [...players.values()].map(player => player.node);
    function getNode(key: PlayerKey = 'kit'): Promise<AudioWorkletNode> {
      const player = playerFor(key);
      if (player.node) return Promise.resolve(player.node);
      player.loading ??= engine.loadWorklet().then(() => {
        // Three outputs: the kit, then what each drum sends to the delay and to the reverb. The lane
        // takes its delay and reverb sends from those two and its other sends from the kit.
        const node = new AudioWorkletNode(engine.getContext(), 'drum-processor', { numberOfOutputs: 3, outputChannelCount: [2, 2, 2] });
        const lane = engine.createLane('drums', DRUM_SEND_MIXES);
        lane.setVolume(volumeRef.current);
        lane.setSends(sendsRef.current, returnRef.current);
        node.connect(lane.input, 0);
        DRUM_SEND_MIXES.forEach((name, index) => node.connect(lane.taps[name]!, index + 1));
        send(node, { type: 'cymbals', cymbals: cymbalsRef.current });
        // Samples chosen before the node existed.
        for (const [instrument, sample] of Object.entries(samplesRef.current)) send(node, { type: 'sample', instrument: instrument as DrumRow, sample });
        if (player.handedTo) lane.handOver(player.handedTo);
        player.lane = lane;
        player.node = node;
        return node;
      }).finally(() => { player.loading = null; });
      return player.loading;
    }
    function setVolume(value: number) {
      volumeRef.current = value;
      players.forEach(player => player.lane?.setVolume(value));
    }
    function setFxSends(sends: FxSendLevels, fxReturn = 1) {
      sendsRef.current = sends; returnRef.current = fxReturn;
      players.forEach(player => player.lane?.setSends(sends, fxReturn));
    }
    function setKit(kit: DrumKitId) { kitRef.current = kit; }
    // The recordings the cymbal lane plays. Each worklet gets its own copy.
    function setCymbals(cymbals: DrumRecordings) {
      cymbalsRef.current = cymbals;
      nodes().forEach(node => send(node, { type: 'cymbals', cymbals }));
    }
    // A lane's sample, or null for its synthesized voice. Each worklet gets its own copy.
    function setSample(instrument: DrumRow, sample: DrumSample | null) {
      if (sample) samplesRef.current[instrument] = sample; else delete samplesRef.current[instrument];
      nodes().forEach(node => send(node, { type: 'sample', instrument, sample }));
    }
    // Hands the whole kit, or one drum, to a guest's tap; null gives it back to the mix. A drum
    // given back plays in the kit again from its next hit.
    function handOver(target: 'drums' | DrumRow, tap: AudioNode | null) {
      const key: PlayerKey = target === 'drums' ? 'kit' : target, player = playerFor(key);
      if (target !== 'drums') {
        if (tap) ownPlayersRef.current.add(target); else ownPlayersRef.current.delete(target);
        if (tap) void getNode(key).catch(() => {});
      }
      player.handedTo = tap;
      player.lane?.handOver(tap);
    }

    async function playDrumHit(instrument: DrumRow, settings: DrumSettings, mutedOrVelocity: boolean | number = false, scheduledTime?: number) {
      if (mutedOrVelocity === true) return;
      const generation = generationRef.current;
      try {
        if (!await engine.ensureReady()) return;
        const node = await getNode(ownPlayersRef.current.has(instrument) ? instrument : 'kit');
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
      nodes().forEach(node => send(node, { type: 'stopAll' }));
    }
    function dispose() {
      stopAllNotes();
      const gone = [...players.values()];
      setTimeout(() => gone.forEach(({ node, lane }) => { node?.disconnect(); node?.port.close(); lane?.dispose(); }), 30);
      players.clear();
      ownPlayersRef.current.clear();
    }
    return { ensureAudioReady: () => engine.ensureReady(), tryResume: () => { void engine.ensureReady(); }, playDrumHit, setVolume, setFxSends, setKit, setSample, setCymbals, setEffectsLoop: (state: EffectsLoopState) => engine.setEffectsLoop(state), handOver, stopAllNotes, dispose };
  }, []);
  useEffect(() => api.dispose, [api]);
  return api;
}
