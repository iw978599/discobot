// The rack's colour scheme: this browser's choice, never the project's. Each scheme is a block of
// colour names in rack.css, chosen by `data-scheme` on the page's root element; Studio, the
// scheme the rack has always had, is the default and sets nothing. "Match this device" follows the
// device's own light or dark setting, between Daylight and Studio, as it changes.

export type SchemeId = 'studio' | 'daylight' | 'contrast' | 'midnight';
export type SchemeChoice = SchemeId | 'device';

export const SCHEMES: Array<{ id: SchemeChoice; name: string; about: string }> = [
  { id: 'studio', name: 'Studio', about: 'Dark grey panels and amber lights, as the rack has always been' },
  { id: 'daylight', name: 'Daylight', about: 'Light panels with dark lettering, for a bright room' },
  { id: 'contrast', name: 'High Contrast', about: 'Black and white with yellow lights, for the clearest edges and words' },
  { id: 'midnight', name: 'Midnight', about: 'Deep blue panels with blue lights' },
  { id: 'device', name: 'Match This Device', about: 'Daylight when the device is set to light, Studio when it is set to dark' },
];

// The colour a browser draws its own bar in, for each scheme: the page behind the rack.
const BAR_COLOUR: Record<SchemeId, string> = { studio: '#1a1a1a', daylight: '#c4c8cb', contrast: '#000000', midnight: '#060a13' };

const KEY = 'discobot_colour_scheme_v1';

export const asSchemeChoice = (value: unknown): SchemeChoice | null => (SCHEMES.some(scheme => scheme.id === value) ? value as SchemeChoice : null);

export function storedScheme(): SchemeChoice {
  try { return asSchemeChoice(localStorage.getItem(KEY)) ?? 'studio'; } catch { return 'studio'; }
}

// The scheme a choice shows, given whether the device asks for light.
export const resolveScheme = (choice: SchemeChoice, deviceLight: boolean): SchemeId => (choice === 'device' ? (deviceLight ? 'daylight' : 'studio') : choice);

const deviceQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null);

function show(choice: SchemeChoice) {
  if (typeof document === 'undefined') return;
  const scheme = resolveScheme(choice, deviceQuery()?.matches ?? false);
  if (scheme === 'studio') delete document.documentElement.dataset.scheme;
  else document.documentElement.dataset.scheme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOUR[scheme]);
}

let current: SchemeChoice = 'studio';
const listeners = new Set<() => void>();
let following = false;

// Puts the stored choice on the page, and keeps "Match this device" following the device. Run
// once, before the first render, so the rack never shows in the wrong colours first.
export function startColourScheme() {
  current = storedScheme();
  show(current);
  if (following) return;
  following = true;
  deviceQuery()?.addEventListener?.('change', () => { if (current === 'device') show(current); });
}

export const colourScheme = {
  get: () => current,
  set(choice: SchemeChoice) {
    current = choice;
    try { localStorage.setItem(KEY, choice); } catch { /* shown, not kept */ }
    show(choice);
    listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
