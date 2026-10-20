import { AUX_KINDS, RATE_SYNCS, syncedRateHz, type AuxBus, type AuxKind, type RateSync } from '@discobot/engine';
import { storedRateSync } from './rateSync';

// The two aux buses every lane, the drums and each guest can send to. Each is pointed at one of
// three effects. They are the same in live playback and export: `createAuxEffect` in
// browserAudio.ts builds the effect, and these say what its two settings mean.
export const AUX_KIND_LABELS: Record<AuxKind, string> = { echo: 'Echo', hall: 'Hall', chorus: 'Chorus' };
export const AUX_NAMES = ['A', 'B'] as const;

interface AuxRange { min: number; max: number }
// What a bus's `main` and `shape` are, and what they may be, for each kind of effect.
export const AUX_LIMITS: Record<AuxKind, { main: AuxRange; shape: AuxRange; mainName: string; shapeName: string; syncs: RateSync[] }> = {
  echo: { main: { min: 0.02, max: 1.5 }, shape: { min: 0, max: 0.85 }, mainName: 'Time', shapeName: 'Feedback', syncs: ['off', '1/2', '1/4d', '1/4', '1/8d', '1/4t', '1/8', '1/8t', '1/16', '1/16t'] },
  hall: { main: { min: 0.3, max: 8 }, shape: { min: 0, max: 1 }, mainName: 'Decay', shapeName: 'Damping', syncs: ['off'] },
  chorus: { main: { min: 0.05, max: 8 }, shape: { min: 0, max: 1 }, mainName: 'Rate', shapeName: 'Depth', syncs: RATE_SYNCS },
};

// What each kind starts with when it is chosen, and the buses a project starts with: A an echo, B a Hall.
export const AUX_KIND_DEFAULT: Record<AuxKind, AuxBus> = {
  echo: { kind: 'echo', level: 0.6, main: 0.375, shape: 0.4 },
  hall: { kind: 'hall', level: 0.8, main: 2.5, shape: 0.4 },
  chorus: { kind: 'chorus', level: 0.7, main: 0.6, shape: 0.5 },
};
export const AUX_DEFAULT: AuxBus[] = [AUX_KIND_DEFAULT.echo, AUX_KIND_DEFAULT.hall];

const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

// One stored bus checked against its kind: anything unknown is the slot's starting bus.
export function sanitizeAuxBus(value: unknown, slot: number): AuxBus {
  const input = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const kind = AUX_KINDS.includes(input.kind as AuxKind) ? input.kind as AuxKind : AUX_DEFAULT[slot].kind;
  const base = kind === AUX_DEFAULT[slot].kind ? AUX_DEFAULT[slot] : AUX_KIND_DEFAULT[kind], limits = AUX_LIMITS[kind];
  const sync = storedRateSync(input.sync);
  return {
    kind, level: num(input.level, base.level, 0, 1),
    main: num(input.main, base.main, limits.main.min, limits.main.max), shape: num(input.shape, base.shape, limits.shape.min, limits.shape.max),
    ...(sync && limits.syncs.includes(sync) ? { sync } : {}),
  };
}

// The two buses, or nothing when both are what a project starts with, so a project that never
// touched them stores nothing for them.
export function sanitizeAux(value: unknown): AuxBus[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const buses = AUX_DEFAULT.map((_, slot) => sanitizeAuxBus(value[slot], slot));
  return buses.every((bus, slot) => JSON.stringify(bus) === JSON.stringify(AUX_DEFAULT[slot])) ? undefined : buses;
}

// Both buses as a loop has them, with the starting ones for any that are not stored.
export const auxBuses = (aux: AuxBus[] | undefined): AuxBus[] => AUX_DEFAULT.map((_, slot) => sanitizeAuxBus(aux?.[slot], slot));

// The echo's time in seconds, its own or a note value at this tempo; the chorus's rate in Hz likewise.
export function auxSeconds(bus: AuxBus, tempo: number): number {
  const rate = syncedRateHz(bus.sync, tempo);
  return Math.max(AUX_LIMITS.echo.main.min, Math.min(AUX_LIMITS.echo.main.max, rate ? 1 / rate : bus.main));
}
export const auxRate = (bus: AuxBus, tempo: number): number => syncedRateHz(bus.sync, tempo) ?? bus.main;
