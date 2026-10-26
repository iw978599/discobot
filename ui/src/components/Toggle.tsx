import type { ReactNode } from 'react';

// An on/off setting, drawn as every one on the rack is: a button, lit while it is on. To a screen
// reader it is a switch that says whether it is on, so it is found and set by its name, as the tick
// box it took the place of was.
export default function Toggle({ label, checked, onChange, disabled, title, className, children }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={['rack-btn', 'toggle', checked ? 'on' : '', className ?? ''].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
    >
      {children}
    </button>
  );
}
