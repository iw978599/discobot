import { useSyncExternalStore } from 'react';

// The width at which rack.css rearranges the rack for a phone. Keep the two the same.
const NARROW = '(max-width: 720px)';

const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null);

function subscribe(listener: () => void) {
  const media = query();
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

// Whether the screen is narrow enough for the phone arrangement of the rack.
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}
