import { useEffect, useRef, useState } from 'react';
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
  | { type: 'controlChange'; controller: number; value: number; channel: number };

interface UseMidiInputOptions {
  onMessage: (message: MidiMessage) => void;
}

const ALL_DEVICES_ID = '__all__';

function parseMessage(event: any): MidiMessage | null {
  const data: Uint8Array | undefined = event?.data;
  if (!data || data.length < 2) return null;

  const status = data[0];
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

    const releaseInput = (inputId: string) => {
      const notes = held.get(inputId);
      if (!notes) return;
      held.delete(inputId);
      notes.forEach(({ note, channel }) => onMessageRef.current({ type: 'noteOff', note, channel }));
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
      } else {
        setLastMessage(`Ch ${parsed.channel} CC ${parsed.controller} (${parsed.value})`);
      }
      onMessageRef.current(parsed);
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
        nextDevices.push({
          id,
          name: input.name || `MIDI ${id.slice(0, 6)}`,
          state,
        });

        const shouldAttach = selectedDeviceId === ALL_DEVICES_ID || selectedDeviceId === id;
        input.onmidimessage = shouldAttach ? (event: any) => onMidiInput(id, event) : null;
        if (shouldAttach && state === 'connected') listening.add(id);
      });
      [...held.keys()].forEach((id) => { if (!listening.has(id)) releaseInput(id); });

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
      [...held.keys()].forEach(releaseInput);
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

  return {
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
  };
}
