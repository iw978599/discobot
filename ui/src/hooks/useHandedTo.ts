import { useMemo, useSyncExternalStore } from 'react';
import { guestInputs } from '../services/guestInput';

// Which guest each handed-over voice is with, by the guest's name (services/guestInput). A unit
// shows it so that a person knows why the voice is not in the mix. Renders only when that changes.
const snapshot = () => JSON.stringify(Object.fromEntries(guestInputs.all().map(entry => [entry.source, entry.guestName])));

export function useHandOvers(): Record<string, string> {
  const text = useSyncExternalStore(guestInputs.subscribe, snapshot);
  return useMemo(() => JSON.parse(text) as Record<string, string>, [text]);
}

// The guest one voice is with, or null while it is in the mix.
export function useHandedTo(source: string): string | null {
  return useSyncExternalStore(guestInputs.subscribe, () => guestInputs.get(source)?.guestName ?? null);
}
