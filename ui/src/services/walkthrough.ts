// Whether this browser has been shown the walkthrough. It is kept per browser, not with the
// account: the account stores nothing it does not need.
const SEEN_KEY = 'discobot_walkthrough_v1';

export function walkthroughSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== null; } catch { return false; }
}

export function markWalkthroughSeen() {
  try { localStorage.setItem(SEEN_KEY, 'seen'); } catch { /* offered again after the next sign-up */ }
}
