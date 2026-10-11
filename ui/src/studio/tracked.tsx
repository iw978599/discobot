import { memo, useLayoutEffect, useRef, type ComponentType } from 'react';
import type { Studio } from './useStudio';

// The studio is one object holding everything, made anew on every render. A unit handed it
// directly renders on every change anywhere: turning a knob on one lane drew the other lanes,
// the drum grid and the effects again.
//
// `tracked` gives a unit a view of the studio that notes which of its values the unit reads.
// The unit then renders again only when one of those has changed. Nothing has to be listed by
// hand, so a unit cannot go stale by starting to read something new.

type Handler = (...args: unknown[]) => unknown;

export interface View<S extends object> {
  // What the unit is given in place of the studio.
  proxy: S;
  // Goes up each time the unit has to be drawn again.
  version: number;
  // The studio a render is being made from. The view answers from it.
  show(studio: S): void;
  // Whether anything the unit has read is different in this studio from what it last drew.
  changed(studio: S): boolean;
  // A render from this studio reached the screen: later studios are compared with it.
  drawn(studio: S): void;
}

export function createView<S extends object>(studio: S): View<S> {
  type Key = keyof S;
  const handlers = new Map<Key, Handler>();
  const read = new Set<Key>();
  const shown = new Map<Key, unknown>();
  let latest = studio;
  const proxy = new Proxy({} as S, {
    get(_target, name) {
      const key = name as Key, value = latest[key];
      if (typeof value !== 'function') {
        read.add(key);
        return value;
      }
      // A handler is not something to compare: many are made again on every render. The unit is
      // given one that stays the same and calls whichever is newest, so a unit that did not
      // render again still never calls an old handler holding old state.
      let handler = handlers.get(key);
      if (!handler) {
        handler = (...args) => (latest[key] as Handler)(...args);
        handlers.set(key, handler);
      }
      return handler;
    },
  });
  return {
    proxy,
    version: 0,
    show(next) { latest = next; },
    // A value read since the last draw (in a handler, say) has nothing to be compared with yet,
    // and counts as changed: one render more than needed, never one fewer.
    changed(next) {
      for (const key of read) if (!shown.has(key) || !Object.is(next[key], shown.get(key))) return true;
      return false;
    },
    drawn(next) {
      for (const key of read) shown.set(key, next[key]);
    },
  };
}

// Browser tests count a unit's renders by putting a function here before the app loads.
const probe = (name: string, props: object) => (globalThis as { __discobotRenders?: (name: string, props: object) => void }).__discobotRenders?.(name, props);

// Wrap a rack unit that takes `studio`. Its other props are compared as `memo` compares them,
// so pass it values that stay the same when they have not changed. The name is for the tests
// and the developer tools; a function's own name does not survive the production build.
// The unit must only call the studio's functions from handlers and effects, never while
// rendering: a function's answer can change without anything the unit has read changing.
export function tracked<P extends { studio: Studio }>(Unit: ComponentType<P>, name: string): ComponentType<P> {
  const Remembered = memo(function Remembered({ view, version: _version, rest }: { view: View<Studio>; version: number; rest: Omit<P, 'studio'> }) {
    probe(name, rest);
    return <Unit {...({ ...rest, studio: view.proxy } as P)} />;
  }, (before, after) => {
    if (before.view !== after.view || before.version !== after.version) return false;
    const a = before.rest as Record<string, unknown>, b = after.rest as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
  });

  function Tracked({ studio, ...rest }: P) {
    const viewRef = useRef<View<Studio> | null>(null);
    const view = viewRef.current ??= createView(studio);
    view.show(studio);
    const version = view.changed(studio) ? view.version + 1 : view.version;
    // What was last drawn is only moved on here, once this render is on the screen. Moved on
    // while rendering, a render React threw away would leave the unit believing it had drawn
    // values it never did, and it would sit out the render that followed.
    useLayoutEffect(() => {
      view.version = version;
      view.drawn(studio);
    });
    return <Remembered view={view} version={version} rest={rest} />;
  }
  Tracked.displayName = `tracked(${name})`;
  return Tracked;
}
