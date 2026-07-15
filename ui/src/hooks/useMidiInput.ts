import { useEffect, useRef, useState } from 'react';

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

export function useMidiInput({ onMessage }: UseMidiInputOptions) {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(ALL_DEVICES_ID);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const accessRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let mounted = true;

    const parseMessage = (event: any): MidiMessage | null => {
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
    };

    const onMidiInput = (event: any) => {
      const parsed = parseMessage(event);
      if (!parsed) return;
      if (parsed.type === 'noteOn') {
        setLastMessage(`Ch ${parsed.channel} Note On ${parsed.note} (${parsed.velocity})`);
      } else if (parsed.type === 'noteOff') {
        setLastMessage(`Ch ${parsed.channel} Note Off ${parsed.note}`);
      } else {
        setLastMessage(`Ch ${parsed.channel} CC ${parsed.controller} (${parsed.value})`);
      }
      onMessageRef.current(parsed);
    };

    const bindInputs = () => {
      const access = accessRef.current;
      if (!access) return;

      const nextDevices: MidiDeviceInfo[] = [];
      let activeInputs = 0;
      const inputs = Array.from(access.inputs.values());

      inputs.forEach((input: any) => {
        const id = String(input.id);
        const state = String(input.state || 'connected');
        nextDevices.push({
          id,
          name: input.name || `MIDI ${id.slice(0, 6)}`,
          state,
        });

        const shouldAttach = selectedDeviceId === ALL_DEVICES_ID || selectedDeviceId === id;
        input.onmidimessage = shouldAttach ? onMidiInput : null;
        if (shouldAttach && state === 'connected') activeInputs += 1;
      });

      if (!mounted) return;
      setDevices(nextDevices);
      setConnected(activeInputs > 0);

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
      const access = accessRef.current;
      if (!access) return;
      Array.from(access.inputs.values()).forEach((input: any) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    };
  }, [selectedDeviceId]);

  return {
    supported,
    connected,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    allDevicesId: ALL_DEVICES_ID,
    lastMessage,
    error,
  };
}
