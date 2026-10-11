// What each operation does to the project. A reducer is the body of the route it replaces,
// moved as it was. It changes the state it is handed and says what to save and send; it never
// emits, saves or reads the clock itself, which is `apply`'s work in localService.ts.
import { number } from './projectSanitization';
import { MAX_GUESTS, guestUrl, patchGuest, sanitizeGuests } from './guests';
import type { ProjectDefaults, ProjectState } from './localService';
import type { Operation, OpResult, OpType, Outcome, Rejected } from './projectOps';

// `origin` is this machine's own address, which a guest may not be loaded from.
export interface ReducerContext { state: ProjectState; defaults: ProjectDefaults; origin: string | undefined }
type Reducers = { [K in OpType]: (ctx: ReducerContext, op: Extract<Operation, { type: K }>) => Outcome<OpResult<K>> };

// What `update(type, data)` was in the router: save, send the event, answer with the same data.
const update = <V>(type: string, data: V): Outcome<V> => ({ ok: true, value: data, save: true, event: { type, data } });
// What `respond({ error }, status)` was. A reducer refuses before it changes anything.
const refuse = (status: Rejected['status'], error: string): Rejected => ({ ok: false, status, error });
const BAD_DATA = 'Invalid local operation data';
const BAD_ADDRESS = 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.';

// An object in an operation, as a route's body used to arrive: after a trip through JSON, which
// leaves out what is undefined, turns NaN and infinity into null, and hands the reducer a copy
// that is nobody else's. Null for anything that is not an object, which `request` answers with
// "Invalid local operation data".
const sent = (value: unknown): Record<string, any> | null => {
  try {
    const parsed = JSON.parse(JSON.stringify(value) ?? 'null');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
};

// Partial until every route has moved; `apply` refuses an operation that has no reducer yet.
export const reducers: Partial<Reducers> = {
  'drum.masterVolume': ({ state }, op) => {
    state.drumMasterVolume = number(op.volume, state.drumMasterVolume, 0, 1);
    return update('drumMasterVolume', { volume: state.drumMasterVolume });
  },
  'drum.swing': ({ state }, op) => {
    state.drumSwing = number(op.swing, state.drumSwing, 0, .75);
    return update('drumSwing', { swing: state.drumSwing });
  },
  'guest.add': ({ state, origin }, op) => {
    const guests = state.guests ?? [];
    const url = guestUrl(op.url, origin);
    if (!url) return refuse(400, BAD_ADDRESS);
    if (guests.length >= MAX_GUESTS) return refuse(409, `A project can hold ${MAX_GUESTS} guest instruments.`);
    // The route made the id itself, so these two could not happen there.
    const [guest] = sanitizeGuests([{ id: op.guestId, url, name: op.name }], origin);
    if (!guest) return refuse(400, 'That is not an id a guest instrument can have.');
    if (guests.some(entry => entry.id === guest.id)) return refuse(409, 'That guest instrument is already in the project.');
    state.guests = [...guests, guest];
    return update('guestsChanged', { guests: state.guests });
  },
  'guest.patch': ({ state }, op) => {
    const patch = sent(op.patch);
    if (!patch) return refuse(400, BAD_DATA);
    const guests = state.guests ?? [];
    if (!guests.some(guest => guest.id === op.guestId)) return refuse(404, 'Guest not found');
    state.guests = guests.map(guest => (guest.id === op.guestId ? patchGuest(guest, patch) : guest));
    return update('guestsChanged', { guests: state.guests });
  },
  'guest.remove': ({ state }, op) => {
    const guests = state.guests ?? [];
    if (!guests.some(guest => guest.id === op.guestId)) return refuse(404, 'Guest not found');
    state.guests = guests.filter(guest => guest.id !== op.guestId);
    // Its settings go from every scene too.
    for (const scene of state.scenes) {
      if (!scene.guests) continue;
      delete scene.guests[op.guestId];
      if (Object.keys(scene.guests).length === 0) delete scene.guests;
    }
    for (const scene of state.scenes) {
      if (!scene.guestMix) continue;
      delete scene.guestMix[op.guestId];
      if (Object.keys(scene.guestMix).length === 0) delete scene.guestMix;
    }
    return update('guestsChanged', { guests: state.guests });
  },
};
