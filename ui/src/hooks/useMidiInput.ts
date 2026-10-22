import { useEffect, useMemo, useRef, useState } from 'react';
import { midiOut, type MidiOutPort } from '../services/midiOutput';

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

const ALL_DEVICES_ID = '__all__';

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

export function useMidiInput({ onMessage }: UseMidiInputOptions) {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(ALL_DEVICES_ID);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MidiDeviceInfo[]>([]);
  // Empty means nothing is sent.
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const selectedOutputRef = useRef(selectedOutputId);
  selectedOutputRef.current = selectedOutputId;
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
        setLastMessage(`Ch ${parsed.channel} CC ${parsed.controller} (${parsed.value})`);
        if (parsed.controller === 1) gestured.add(inputId);
      } else if (parsed.type === 'pressure') {
        gestured.add(inputId);
      } else if (parsed.type === 'start' || parsed.type === 'continue' || parsed.type === 'stop') {
        setLastMessage(`Clock ${parsed.type}`);
      }
      // A clock pulse, 24 to a beat, is handed on and shows nothing: it must not draw the page.
      onMessageRef.current(parsed, sourceOf(inputId));
    };

    // Points the sequencer's MIDI output at the chosen device, or at nothing if it has gone.
    const bindOutput = () => {
      const access = accessRef.current;
      const ports: MidiOutPort[] = access?.outputs ? Array.from(access.outputs.values()) : [];
      const connected = ports.filter((port: any) => String(port.state || 'connected') === 'connected');
      if (mounted) setOutputs(connected.map((port: any) => ({ id: String(port.id), name: port.name || `MIDI ${String(port.id).slice(0, 6)}`, state: 'connected' })));
      const chosen = connected.find(port => String(port.id) === selectedOutputRef.current) ?? null;
      midiOut.setPort(chosen);
      if (!chosen && selectedOutputRef.current && mounted && access) setSelectedOutputId('');
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

        const shouldAttach = selectedDeviceId === ALL_DEVICES_ID || selectedDeviceId === id;
        input.onmidimessage = shouldAttach ? (event: any) => onMidiInput(id, event) : null;
        if (shouldAttach && state === 'connected') listening.add(id);
      });
      new Set([...held.keys(), ...gestured]).forEach((id) => { if (!listening.has(id)) releaseInput(id); });

      if (!mounted) return;
      setDevices(nextDevices);
      setConnected(listening.size > 0);

      if (selectedDeviceId !== ALL_DEVICES_ID && !nextDevices.some((d) => d.id === selectedDeviceId)) {
        setSelectedDeviceId(ALL_DEVICES_ID);
      }
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
  }, [selectedDeviceId]);

  useEffect(() => { bindOutputRef.current(); }, [selectedOutputId]);
  useEffect(() => () => { midiOut.setPort(null); }, []);

  // The same object until one of these changes: a unit that reads it (the transport bar, which is
  // tracked) then renders only for a change in MIDI, not for every edit to the project.
  return useMemo(() => ({
    supported,
    connected,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    allDevicesId: ALL_DEVICES_ID,
    lastMessage,
    error,
    outputs,
    selectedOutputId,
    setSelectedOutputId,
  }), [supported, connected, devices, selectedDeviceId, lastMessage, error, outputs, selectedOutputId]);
}
