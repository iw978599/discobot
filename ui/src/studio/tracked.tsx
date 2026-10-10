import { memo, useRef, type ComponentType } from 'react';
import type { Studio } from './useStudio';

// The studio is one object holding everything, made anew on every render. A unit handed it
// directly renders on every change anywhere: turning a knob on one lane drew the other lanes,
// the drum grid and the effects again.
//
// `tracked` gives a unit a view of the studio that notes which of its values the unit reads.
// The unit then renders again only when one of those has changed. Nothing has to be listed by
// hand, so a unit cannot go stale by starting to read something new.

type Key = keyof Studio;
type Handler = (...args: unknown[]) => unknown;

interface View {
  // The studio as of the newest render. The view always answers from this.
  latest: Studio;
  // Every value the unit has read, as it was when last compared.
  reads: Map<Key, unknown>;
  version: number;
  proxy: Studio;
}

function createView(studio: Studio): View {
  const handlers = new Map<Key, Handler>();
  const view: View = { latest: studio, reads: new Map(), version: 0, proxy: studio };
  view.proxy = new Proxy({} as Studio, {
    get(_target, name) {
      const key = name as Key, value = view.latest[key];
      if (typeof value !== 'function') {
        view.reads.set(key, value);
        return value;
      }
      // A handler is not something to compare: many are made again on every render. The unit is
      // given one that stays the same and calls whichever is newest, so a unit that did not
      // render again still never calls an old handler holding old state.
      let handler = handlers.get(key);
      if (!handler) {
        handler = (...args) => (view.latest[key] as Handler)(...args);
        handlers.set(key, handler);
      }
      return handler;
    },
  });
  return view;
}

// Wrap a rack unit that takes `studio`. Its other props are compared as `memo` compares them,
// so pass it values that stay the same when they have not changed.
// The unit must only call the studio's functions from handlers and effects, never while
// rendering: a function's answer can change without anything the unit has read changing.
export function tracked<P extends { studio: Studio }>(Unit: ComponentType<P>): ComponentType<P> {
  const Remembered = memo(function Remembered({ view, version: _version, rest }: { view: View; version: number; rest: Omit<P, 'studio'> }) {
    return <Unit {...({ ...rest, studio: view.proxy } as P)} />;
  }, (before, after) => {
    if (before.view !== after.view || before.version !== after.version) return false;
    const a = before.rest as Record<string, unknown>, b = after.rest as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
  });

  return function Tracked({ studio, ...rest }: P) {
    const viewRef = useRef<View | null>(null);
    const view = viewRef.current ??= createView(studio);
    view.latest = studio;
    let changed = false;
    for (const [key, value] of view.reads) if (!Object.is(studio[key], value)) { changed = true; break; }
    if (changed) {
      for (const key of view.reads.keys()) view.reads.set(key, studio[key]);
      view.version += 1;
    }
    return <Remembered view={view} version={view.version} rest={rest} />;
  };
}
