import { useRef, useCallback, useEffect, useMemo } from 'react';
import type { SynthParameters, EffectsLoopState, FxSendLevels } from '../types';
import { toVoiceParams, type LanesWorkletMessage, type SynthSample, type SynthWorkletMessage, type VoiceParams } from '@discobot/engine';
import { MAX_LANES } from '../services/lanes';
import { automationChange } from '../services/automation';
import { audioEngine, type AudioEngine } from './browserAudio';

interface SynthLane {
  id: number;
  // The one `lanes-processor` every lane plays in, once this lane's output is wired to its audio.
  node?: AudioWorkletNode;
  audio?: ReturnType<AudioEngine['createLane']>;
  loading?: Promise<AudioWorkletNode>;
  parameters?: SynthParameters;
  // The sound last sent, as text with the tempo: what is the same as it is not sent again.
  sent?: string;
  // What the lane's automation last set, by the voice's own names. While there is any, those
  // parameters are the automation's: a change to the sound made now leaves them alone, and the
  // next step sends them at its own time.
  automated?: Partial<VoiceParams> | null;
  // The send levels the automation last set, while it sets any. A change to the sound leaves the
  // sends alone meanwhile: a level set now would stand until the next step put its own.
  automatedSends?: FxSendLevels | null;
  // The recording the lane's sample engine plays, kept for a node that does not exist yet.
  sample?: SynthSample | null;
  // The controller's bend and wheel as last sent, for a node that does not exist yet.
  live?: { bend: number; wheel: number; pressure: number };
  // Where the lane is handed to a guest (services/guestInput), for audio that does not exist yet.
  handedTo?: AudioNode | null;
  bpm: number;
  generation: number;
  // Note-ons still waiting on audio resume or worklet loading, keyed by note name.
  starting: Map<string, Set<number>>;
}

const send = (lane: SynthLane, message: SynthWorkletMessage) => lane.node?.port.postMessage({ lane: lane.id, message } satisfies LanesWorkletMessage);
// A lane's sound for the voice, without the parameters its automation is holding.
const soundFor = (lane: SynthLane): Partial<VoiceParams> => {
  const sound: Partial<VoiceParams> = toVoiceParams(lane.parameters!, lane.bpm);
  for (const name of Object.keys(lane.automated ?? {}) as Array<keyof VoiceParams>) delete sound[name];
  return sound;
};

// `engine` is the app's unless another is given (a test's, say).
export function useSynthAudio(engine: AudioEngine = audioEngine) {
  const lanesRef = useRef(new Map<number, SynthLane>());
  const volumeRef = useRef(1);
  const sequenceRef = useRef(0);
  // The one node every lane plays in (docs/SURGE_XT_PLAN.md, stage 2), lane N on output N - 1.
  const hostRef = useRef<{ node?: AudioWorkletNode; loading?: Promise<AudioWorkletNode> }>({});

  function laneFor(id: number): SynthLane {
    let lane = lanesRef.current.get(id);
    if (!lane) {
      lane = { id, bpm: 120, generation: 0, starting: new Map() };
      lanesRef.current.set(id, lane);
    }
    return lane;
  }
  // A sound the lane has already, or has been sent for a time still to come (changeSound), is not sent again.
  const updateParameters = useCallback((parameters: SynthParameters, bpm = 120, loop?: EffectsLoopState, synthId = 1) => {
    const lane = laneFor(synthId);
    if (loop) engine.setEffectsLoop(loop);
    const sent = `${bpm}|${JSON.stringify(parameters)}`;
    lane.parameters = parameters;
    if (sent === lane.sent) return;
    lane.sent = sent;
    lane.bpm = bpm;
    send(lane, { type: 'params', params: soundFor(lane) });
    if (!lane.automatedSends) lane.audio?.setSends(parameters.fxSends, parameters.fxReturn);
  }, []);
  // Another instrument from `time` on the audio clock: a scene with a sound of its own beginning
  // (services/sceneSounds.ts), with its own level, pan and sends.
  const changeSound = useCallback((synthId: number, parameters: SynthParameters, bpm: number, time: number) => {
    const lane = laneFor(synthId);
    const sent = `${bpm}|${JSON.stringify(parameters)}`;
    if (!lane.parameters || sent === lane.sent) return;
    lane.sent = sent;
    lane.parameters = parameters;
    lane.bpm = bpm;
    send(lane, { type: 'params', params: soundFor(lane), time, keep: true });
    if (!lane.automatedSends) lane.audio?.setSends(parameters.fxSends, parameters.fxReturn, time);
  }, []);
  // A step's automation: what the voice is to be at `time` on the audio clock, which is when the
  // step sounds (the scheduler works ahead of it). With nothing for the step, whatever automation
  // last set goes back to the lane's own sound at that time. Without a time it is made now.
  // `sends` is the step's send levels when any send is automated; without, the sound's go back.
  const automate = useCallback((synthId: number, parameters: SynthParameters, bpm: number, step: Partial<VoiceParams> | null, time?: number, sends: FxSendLevels | null = null) => {
    const lane = laneFor(synthId);
    if (!lane.parameters) { lane.parameters = parameters; lane.bpm = bpm; }
    if (sends || lane.automatedSends) {
      lane.automatedSends = sends;
      lane.audio?.setSends(sends ?? lane.parameters.fxSends, lane.parameters.fxReturn, time);
    }
    if (!step && !lane.automated) return;
    const change = automationChange(lane.automated ?? null, step, toVoiceParams(lane.parameters, lane.bpm));
    lane.automated = step;
    // Made now, it is a knob being recorded: what was waiting for the steps already scheduled is older than it.
    if (time === undefined) send(lane, { type: 'unschedule' });
    if (change) send(lane, { type: 'params', params: change, time });
  }, []);
  // The transport has stopped: nothing more is waiting, and every lane is back at its own sound.
  const endAutomation = useCallback(() => {
    lanesRef.current.forEach(lane => {
      send(lane, { type: 'unschedule' });
      if (lane.automatedSends) {
        lane.automatedSends = null;
        if (lane.parameters) lane.audio?.setSends(lane.parameters.fxSends, lane.parameters.fxReturn);
      }
      if (!lane.automated) return;
      lane.automated = null;
      if (lane.parameters) send(lane, { type: 'params', params: toVoiceParams(lane.parameters, lane.bpm) });
    });
  }, []);

  function getHost(): Promise<AudioWorkletNode> {
    const host = hostRef.current;
    if (host.node) return Promise.resolve(host.node);
    host.loading ??= engine.loadWorklet().then(() => {
      const node = new AudioWorkletNode(engine.getContext(), 'lanes-processor', {
        numberOfInputs: 0, numberOfOutputs: MAX_LANES, outputChannelCount: Array.from({ length: MAX_LANES }, () => 2),
      });
      host.node = node;
      return node;
    }).finally(() => { host.loading = undefined; });
    return host.loading;
  }

  async function getNode(lane: SynthLane): Promise<AudioWorkletNode> {
    if (lane.node) return lane.node;
    if (!lane.loading) {
      const generation = lane.generation;
      lane.loading = getHost().then((node) => {
        if (generation !== lane.generation) throw new Error('Audio lane stopped');
        const audio = engine.createLane('synth');
        audio.setVolume(volumeRef.current);
        node.connect(audio.input, lane.id - 1);
        lane.audio = audio;
        lane.node = node;
        if (lane.parameters) {
          send(lane, { type: 'params', params: toVoiceParams(lane.parameters, lane.bpm) });
          // A step's automation sent before there was a node to send it to.
          if (lane.automated) send(lane, { type: 'params', params: lane.automated });
          audio.setSends(lane.automatedSends ?? lane.parameters.fxSends, lane.parameters.fxReturn);
        }
        if (lane.sample) send(lane, { type: 'sample', sample: lane.sample });
        if (lane.live) send(lane, { type: 'live', ...lane.live });
        if (lane.handedTo) audio.handOver(lane.handedTo);
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
      if (!await engine.ensureReady() || cancelled()) return;
      if (parameters) updateParameters(parameters, bpm, loop, synthId);
      else if (loop) engine.setEffectsLoop(loop);
      await getNode(lane);
      if (cancelled()) return;
      send(lane, { type: 'noteOn', note, velocity, id, duration, time: scheduledTime });
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
    send(lane, { type: 'noteOff', note });
  }, []);
  const stopSynth = useCallback((synthId: number, release = 0.03) => {
    const lane = lanesRef.current.get(synthId);
    if (!lane) return;
    lane.generation++;
    lane.starting.clear();
    send(lane, { type: 'allNotesOff', release });
  }, []);
  // A lane's recording for its sample engine, or null for none, from `time` if it is given. The
  // worklet gets its own copy, once: the recording it has, or will have, is not sent again.
  const setSample = useCallback((synthId: number, sample: SynthSample | null, time?: number) => {
    const lane = laneFor(synthId);
    if (lane.sample === sample) return;
    lane.sample = sample;
    send(lane, { type: 'sample', sample, time });
  }, []);
  // Hands the lane to a guest's tap, or with null gives it back to the mix.
  const handOver = useCallback((synthId: number, tap: AudioNode | null) => {
    const lane = laneFor(synthId);
    lane.handedTo = tap;
    lane.audio?.handOver(tap);
  }, []);
  const duck = useCallback((synthId: number, time: number, amount: number) => {
    lanesRef.current.get(synthId)?.audio?.duck(time, amount);
  }, []);
  // A controller's bend (-1 to 1), mod wheel and aftertouch (0 to 1) for a lane; any left out stays where it was.
  const setLive = useCallback((synthId: number, live: { bend?: number; wheel?: number; pressure?: number }) => {
    const lane = laneFor(synthId);
    lane.live = { bend: 0, wheel: 0, pressure: 0, ...lane.live, ...live };
    send(lane, { type: 'live', ...live });
  }, []);
  // Stopping lets go of the bend, as the wheel springs back; the mod wheel stays where the hand left it.
  const stopAllNotes = useCallback((release = 0.03) => {
    lanesRef.current.forEach((lane, id) => {
      stopSynth(id, release);
      if (lane.live?.bend) setLive(id, { bend: 0 });
    });
  }, [stopSynth, setLive]);
  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    lanesRef.current.forEach(lane => lane.audio?.setVolume(volumeRef.current));
  }, []);
  // What a picture of a lane's sound reads: none until the lane has sounded.
  const analyser = useCallback((synthId: number) => lanesRef.current.get(synthId)?.audio?.analyser() ?? null, []);
  const dispose = useCallback(() => {
    stopAllNotes();
    const previous = [...lanesRef.current.values()], host = hostRef.current;
    lanesRef.current.clear();
    hostRef.current = {};
    setTimeout(() => {
      host.node?.disconnect(); host.node?.port.close();
      previous.forEach(lane => lane.audio?.dispose());
    }, 50);
  }, [stopAllNotes]);
  useEffect(() => dispose, [dispose]);
  // The same object on every render, so effects and callbacks that depend on it do not re-run.
  return useMemo(() => ({
    ensureAudioReady: () => engine.ensureReady(), tryResume: () => { void engine.ensureReady(); },
    playNote, stopNote, stopSynth, stopAllNotes, updateParameters, changeSound, automate, endAutomation, setEffectsLoop: (state: EffectsLoopState) => engine.setEffectsLoop(state), setVolume, setSample, setLive, duck, handOver, analyser, dispose,
  }), [playNote, stopNote, stopSynth, stopAllNotes, updateParameters, changeSound, automate, endAutomation, setVolume, setSample, setLive, duck, handOver, analyser, dispose]);
}
