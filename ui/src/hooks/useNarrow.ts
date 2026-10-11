import { useSyncExternalStore } from 'react';

// The screens rack.css rearranges the rack for: a phone held upright, and a phone on its side,
// which is wider than that but very short. Keep the two the same.
const NARROW = '(max-width: 720px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape)';

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
