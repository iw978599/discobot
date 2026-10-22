// Every keyboard and pointer shortcut the app has, in one list: the Keyboard Shortcuts dialog
// shows and searches it. A new shortcut is added here with the code that answers it. The keys
// are written the way a key is labelled; Ctrl stands for Cmd on a Mac.

// `keys` are the ways to do it, each a combination written like 'Ctrl + Z'.
export interface Shortcut { keys: string[]; does: string }
export interface ShortcutGroup { title: string; shortcuts: Shortcut[] }

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Playing',
    shortcuts: [
      { keys: ['Space'], does: 'Play or stop everything, as Play All does. A focused button or text field takes Space for itself.' },
      { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], does: 'Play the white keys on the open lane' },
      { keys: ['W', 'E', 'T', 'Y', 'U', 'O', 'P'], does: 'Play the black keys on the open lane' },
      { keys: ['Z', 'X'], does: 'Move the computer keyboard an octave down or up' },
      { keys: ['Shift + T'], does: 'Tap the tempo' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Ctrl + Z'], does: 'Undo' },
      { keys: ['Ctrl + Shift + Z', 'Ctrl + Y'], does: 'Redo' },
      { keys: ['←', '→'], does: 'With a step selected, select the step before or after it' },
      { keys: ['Shift + Click'], does: 'On a drum hit, step through its strengths' },
      { keys: ['Alt + Click'], does: 'In the piano roll, put a note in half a step late' },
      { keys: ['Alt + ↑', 'Alt + ↓'], does: 'On a lane\'s name, move the lane up or down the rack' },
      { keys: ['Alt + ←', 'Alt + →'], does: 'On a scene, a song block or a playlist row, move it along' },
      { keys: ['Escape'], does: 'Put back something being dragged; close a menu or a dialog' },
      { keys: ['Shift + M'], does: 'On a unit\'s switch on a phone\'s bar, mute or unmute it' },
    ],
  },
  {
    title: 'Without a mouse',
    shortcuts: [
      { keys: ['Tab'], does: 'Move to the next control. A row of steps, the drum grid, the piano roll and the on-screen keys are each one stop' },
      { keys: ['←', '→', '↑', '↓'], does: 'Inside a row of steps, the drum grid, the piano roll or a row of tabs, move from one to the next' },
      { keys: ['Home', 'End'], does: 'Go to the first or the last of them' },
      { keys: ['Space', 'Enter'], does: 'Press the one you are on' },
      { keys: ['↑', '↓'], does: 'On the on-screen keys, move a semitone up or down' },
    ],
  },
  {
    title: 'Knobs and faders',
    shortcuts: [
      { keys: ['↑', '→'], does: 'Turn up a little (with Shift, ten times as far)' },
      { keys: ['↓', '←'], does: 'Turn down a little (with Shift, ten times as far)' },
      { keys: ['Page Up', 'Page Down'], does: 'Turn up or down a long way' },
      { keys: ['Home', 'End'], does: 'Turn all the way down or all the way up' },
      { keys: ['Wheel'], does: 'Turn it, once the pointer has rested on it (with Shift, a step at a time)' },
      { keys: ['Middle click'], does: 'Put it back where it started' },
      { keys: ['Enter', 'Escape'], does: 'In the figure under it: keep what was typed, or leave it as it was' },
    ],
  },
  {
    title: 'Automation',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Raise or lower a step\'s bar (with Shift, finely)' },
      { keys: ['Home', 'End'], does: 'Set a step\'s bar to the bottom or the top' },
      { keys: ['Delete'], does: 'Empty a step, so it plays the knob as it is set' },
    ],
  },
  {
    title: 'Menus and Help',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Move along a menu; in the preset menu, → opens a group and ← goes back' },
      { keys: ['Enter'], does: 'In the preset menu\'s search, load the first sound found' },
      { keys: ['Shift + ?'], does: 'Show this list of shortcuts' },
    ],
  },
];

// The words a shortcut is found by: what it does, its keys and its group's title.
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}←→↑↓?]+/gu, ' ').trim();

// The groups with only the shortcuts every word typed is found in. An empty search keeps all.
export function findShortcuts(query: string, groups: ShortcutGroup[] = SHORTCUT_GROUPS): ShortcutGroup[] {
  const words = plain(query).split(' ').filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map(group => ({
      ...group,
      shortcuts: group.shortcuts.filter(shortcut => {
        const text = ` ${plain([group.title, shortcut.does, ...shortcut.keys].join(' '))} `;
        return words.every(word => text.includes(word));
      }),
    }))
    .filter(group => group.shortcuts.length > 0);
}

// Whether a key press opens the list: "?" (Shift and the slash key on most keyboards), with
// nothing else held, and not while typing in a field, where "?" is a character.
export function opensShortcuts(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, target: EventTarget | null): boolean {
  if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return false;
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return true;
  return !element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}
