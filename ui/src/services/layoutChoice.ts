// The rack's layout: this browser's choice, never the project's. The rack is the default; the desk
// is an option to try (docs/DESK_LAYOUT_PLAN.md). `data-layout="desk"` on the page's root element
// is what every desk rule in rack.css is scoped under, and the rack sets nothing.

export type LayoutId = 'rack' | 'desk';

const KEY = 'discobot_layout_v1';

export const asLayout = (value: unknown): LayoutId | null => (value === 'rack' || value === 'desk' ? value : null);

export function storedLayout(): LayoutId {
  try { return asLayout(localStorage.getItem(KEY)) ?? 'rack'; } catch { return 'rack'; }
}

function show(choice: LayoutId) {
  if (typeof document === 'undefined') return;
  if (choice === 'desk') document.documentElement.dataset.layout = 'desk';
  else delete document.documentElement.dataset.layout;
}

let current: LayoutId = 'rack';
const listeners = new Set<() => void>();

// Puts the stored choice on the page. Run once, before the first render.
export function startLayout() {
  current = storedLayout();
  show(current);
}

export const layoutChoice = {
  get: () => current,
  set(choice: LayoutId) {
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
