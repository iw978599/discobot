import { useEffect } from 'react';

// Keeps the screen on while `active`. A phone left alone would otherwise dim and lock in the
// middle of a song. A browser without the Wake Lock API, or one that refuses, is left as it is.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null, ended = false;
    const request = () => {
      if (ended || lock || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((sentinel) => {
        if (ended) { void sentinel.release().catch(() => {}); return; }
        lock = sentinel;
        // The browser lets go of it whenever the page is hidden; ask again when it is back.
        sentinel.addEventListener('release', () => { if (lock === sentinel) lock = null; });
      }, () => {});
    };
    document.addEventListener('visibilitychange', request);
    request();
    return () => {
      ended = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
