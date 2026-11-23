import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { midiOut, type MidiOutFlags, type MidiOutPort } from '../services/midiOutput';
import { outputFlagsFor, storeMidiOutputSettings, storedMidiOutputSettings, withOutputFlags, type MidiOutputSettings } from '../services/midiDevices';
import { midiHeardAt } from '../services/midiChannels';
import { SUSTAIN_PEDAL } from '../services/midiSustain';

export type MidiMode = 'live' | 'record' | 'step';

export interface MidiDeviceInfo {
  id: string;
  name: string;
  state: string;
}

export type MidiMessage =
  | { type: 'noteOn'; note: number; velocity: number; channel: number }
  | { type: 'noteOff'; note: number; channel: number }
  | { type: 'controlChange'; controller: number; value: number; channel: number }
  // -1 to 1, 0 at the wheel's rest
  | { type: 'pitchBend'; value: number; channel: number }
  // Aftertouch, 0 to 1: the whole channel's, or one key's (polyphonic), which a lane takes as its own
  | { type: 'pressure'; value: number; channel: number }
  // The real-time messages another device's clock sends: 24 pulses a quarter note, and start,
  // continue and stop. `at` is when it arrived, on the performance.now() clock.
  | { type: 'clock'; at: number } | { type: 'start'; at: number } | { type: 'continue'; at: number } | { type: 'stop'; at: number }
  // the device went away: its bend and wheel should be let go
  | { type: 'deviceGone' };

// The input a message came from. Its name is what a device's place is kept by.
export interface MidiSource {
  id: string;
  name: string;
}

interface UseMidiInputOptions {
  onMessage: (message: MidiMessage, source: MidiSource) => void;
}

const REAL_TIME: Record<number, 'clock' | 'start' | 'continue' | 'stop'> = { 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop' };

export function parseMessage(event: any): MidiMessage | null {
  const data: Uint8Array | undefined = event?.data;
  if (!data || data.length < 1) return null;
  const status = data[0];
  const realTime = REAL_TIME[status];
  if (realTime) return { type: realTime, at: typeof event.timeStamp === 'number' ? event.timeStamp : performance.now() };
  if (data.length < 2) return null;

  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data1 = data[1] ?? 0;
  const data2 = data[2] ?? 0;

  if (type === 0x90) {
    if (data2 === 0) return { type: 'noteOff', note: data1, channel };
    return { type: 'noteOn', note: data1, velocity: data2, channel };
  }
  if (type === 0x80) {
    return { type: 'noteOff', note: data1, channel };
  }
  if (type === 0xb0) {
    return { type: 'controlChange', controller: data1, value: data2, channel };
  }
  if (type === 0xd0) return { type: 'pressure', value: Math.min(1, data1 / 127), channel };
  if (type === 0xa0) return { type: 'pressure', value: Math.min(1, data2 / 127), channel };
  if (type === 0xe0) {
    const raw = (data1 & 0x7f) | ((data2 & 0x7f) << 7);
    return { type: 'pitchBend', value: Math.max(-1, Math.min(1, (raw - 8192) / (raw >= 8192 ? 8191 : 8192))), channel };
  }
  return null;
}

// Every MIDI input is listened to (a device's place in the panel can set one Off), and every
// output is handed to `midiOut` with what it is sent, both following devices plugged in and out.
export function useMidiInput({ onMessage }: UseMidiInputOptions) {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MidiDeviceInfo[]>([]);
  // What each output is sent, by its name; kept in this browser.
  const [outputSettings, setOutputSettings] = useState<MidiOutputSettings>(storedMidiOutputSettings);
  const outputSettingsRef = useRef(outputSettings);
  outputSettingsRef.current = outputSettings;
  const bindOutputRef = useRef<() => void>(() => {});

  const accessRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let mounted = true;
    // Notes each input is still holding, so a device that goes away cannot leave them sounding.
    const held = new Map<string, Map<string, { note: number; channel: number }>>();
    const names = new Map<string, string>();
    const sourceOf = (inputId: string): MidiSource => ({ id: inputId, name: names.get(inputId) ?? inputId });

    const gestured = new Set<string>();
    const releaseInput = (inputId: string) => {
      if (gestured.delete(inputId)) onMessageRef.current({ type: 'deviceGone' }, sourceOf(inputId));
      const notes = held.get(inputId);
      if (!notes) return;
      held.delete(inputId);
      notes.forEach(({ note, channel }) => onMessageRef.current({ type: 'noteOff', note, channel }, sourceOf(inputId)));
    };

    const onMidiInput = (inputId: string, event: any) => {
      // Passed on before anything here is done with it, so Thru adds as little delay as it can.
      const data = event?.data;
      if (data && data.length > 0 && data[0] >= 0x80 && data[0] < 0xf0) {
        midiHeardAt.set((data[0] & 0x0f) + 1, performance.now());
        midiOut.thru(data, names.get(inputId) ?? inputId);
      }
      const parsed = parseMessage(event);
      if (!parsed) return;
      if (parsed.type === 'noteOn') {
        setLastMessage(`Ch ${parsed.channel} Note On ${parsed.note} (${parsed.velocity})`);
        let notes = held.get(inputId);
        if (!notes) held.set(inputId, notes = new Map());
        notes.set(`${parsed.channel}:${parsed.note}`, { note: parsed.note, channel: parsed.channel });
      } else if (parsed.type === 'noteOff') {
        setLastMessage(`Ch ${parsed.channel} Note Off ${parsed.note}`);
        held.get(inputId)?.delete(`${parsed.channel}:${parsed.note}`);
      } else if (parsed.type === 'pitchBend') {
        setLastMessage(`Ch ${parsed.channel} Pitch bend ${Math.round(parsed.value * 100)}%`);
        gestured.add(inputId);
      } else if (parsed.type === 'controlChange') {
        // The mod wheel and the sustain pedal are let go when the device goes, before its notes are.
        setLastMessage(`Ch ${parsed.channel} ${parsed.controller === SUSTAIN_PEDAL ? 'Sustain' : `CC ${parsed.controller}`} (${parsed.value})`);
        if (parsed.controller === 1 || parsed.controller === SUSTAIN_PEDAL) gestured.add(inputId);
      } else if (parsed.type === 'pressure') {
        gestured.add(inputId);
      } else if (parsed.type === 'start' || parsed.type === 'continue' || parsed.type === 'stop') {
        setLastMessage(`Clock ${parsed.type}`);
      }
      // A clock pulse, 24 to a beat, is handed on and shows nothing: it must not draw the page.
      onMessageRef.current(parsed, sourceOf(inputId));
    };

    // Hands every connected output to the sender with what it is sent; one that has gone is let go of.
    const bindOutput = () => {
      const access = accessRef.current;
      const ports: any[] = access?.outputs ? Array.from(access.outputs.values()) : [];
      const named = ports
        .filter(port => String(port.state || 'connected') === 'connected')
        .map(port => ({ port: port as MidiOutPort, name: String(port.name || `MIDI ${String(port.id).slice(0, 6)}`) }));
      if (mounted) setOutputs(named.map(({ port, name }) => ({ id: String(port.id), name, state: 'connected' })));
      midiOut.setOutputs(named.map(({ port, name }) => ({ port, flags: outputFlagsFor(outputSettingsRef.current, name) })));
    };
    bindOutputRef.current = bindOutput;

    const bindInputs = () => {
      const access = accessRef.current;
      if (!access) return;
      bindOutput();

      const nextDevices: MidiDeviceInfo[] = [];
      const listening = new Set<string>();
      Array.from(access.inputs.values()).forEach((input: any) => {
        const id = String(input.id);
        const state = String(input.state || 'connected');
        const name = input.name || `MIDI ${id.slice(0, 6)}`;
        names.set(id, name);
        nextDevices.push({ id, name, state });
        input.onmidimessage = (event: any) => onMidiInput(id, event);
        if (state === 'connected') listening.add(id);
      });
      new Set([...held.keys(), ...gestured]).forEach((id) => { if (!listening.has(id)) releaseInput(id); });

      if (!mounted) return;
      setDevices(nextDevices);
      setConnected(listening.size > 0);
    };

    const init = async () => {
      if (typeof navigator === 'undefined' || !(navigator as any).requestMIDIAccess) {
        if (mounted) setSupported(false);
        return;
      }

      setSupported(true);
      try {
        const access = await (navigator as any).requestMIDIAccess({ sysex: false });
        if (!mounted) return;
        accessRef.current = access;
        access.onstatechange = () => bindInputs();
        bindInputs();
      } catch {
        if (mounted) {
          setError('MIDI permission denied');
          setConnected(false);
        }
      }
    };

    void init();

    return () => {
      mounted = false;
      new Set([...held.keys(), ...gestured]).forEach(releaseInput);
      const access = accessRef.current;
      if (!access) return;
      Array.from(access.inputs.values()).forEach((input: any) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    };
  }, []);

  useEffect(() => { storeMidiOutputSettings(outputSettings); bindOutputRef.current(); }, [outputSettings]);
  useEffect(() => () => { midiOut.setOutputs([]); }, []);
  const setOutputFlags = useCallback((name: string, patch: Partial<MidiOutFlags>) => setOutputSettings(current => withOutputFlags(current, name, patch)), []);

  // The same object until one of these changes: a unit that reads it (the transport bar, which is
  // tracked) then renders only for a change in MIDI, not for every edit to the project.
  return useMemo(() => ({
    supported,
    connected,
    devices,
    lastMessage,
    error,
    outputs,
    outputSettings,
    setOutputFlags,
  }), [supported, connected, devices, lastMessage, error, outputs, outputSettings, setOutputFlags]);
}
