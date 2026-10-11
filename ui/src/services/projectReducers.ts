// What each operation does to the project. A reducer is the body of the route it replaces,
// moved as it was. It changes the state it is handed and says what to save and send; it never
// emits, saves or reads the clock itself, which is `apply`'s work in localService.ts.
import { number } from './projectSanitization';
import type { ProjectDefaults, ProjectState } from './localService';
import type { Operation, OpResult, OpType, Outcome } from './projectOps';

export interface ReducerContext { state: ProjectState; defaults: ProjectDefaults }
type Reducers = { [K in OpType]: (ctx: ReducerContext, op: Extract<Operation, { type: K }>) => Outcome<OpResult<K>> };

// What `update(type, data)` was in the router: save, send the event, answer with the same data.
const update = <V>(type: string, data: V): Outcome<V> => ({ ok: true, value: data, save: true, event: { type, data } });

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
};
