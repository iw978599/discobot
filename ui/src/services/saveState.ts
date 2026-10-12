export type SaveStateInput = {
  // localService.saveState(): what this browser knows about writing the project.
  save: 'paused' | 'failed' | 'saving' | 'saved';
  signedIn: boolean;
  // This project is one of the account's, or a shared one, and the last upload began after the last edit was written.
  inAccount: boolean;
  accountCurrent: boolean;
  // This project is listed as in this browser only, while signed in.
  browserOnly: boolean;
};

export interface SaveLabel {
  // The few words shown on the bar.
  short: string;
  // The sentence a screen reader hears and a hover shows.
  long: string;
}

// The one place that says what the work's state is called. It only reports what the app knows:
// that a write to this browser happened, and that a sync pass that began after it finished.
export function saveLabel(input: SaveStateInput): SaveLabel {
  if (input.save === 'paused') return { short: 'Not saving', long: 'Not saving: another tab has this project' };
  if (input.save === 'failed') return { short: 'Not saved', long: 'Not saved: this browser refused the write' };
  if (input.save === 'saving') return { short: 'Saving…', long: 'Saving' };
  if (!input.signedIn) return { short: 'Saved', long: 'Saved in this browser' };
  if (input.inAccount && input.accountCurrent) return { short: 'In account', long: 'Saved and in your account' };
  if (input.browserOnly) return { short: 'Browser only', long: 'Saved in this browser only, not in your account' };
  if (input.inAccount) return { short: 'Saved', long: 'Saved in this browser, on its way to your account' };
  return { short: 'Saved', long: 'Saved in this browser' };
}
