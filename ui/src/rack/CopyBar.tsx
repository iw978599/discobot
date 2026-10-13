import Menu from './Menu';

interface CopyBarProps {
  // Whose bar it is, as it is said: "Synth 1", "the drums".
  part: string;
  // The bar on show, counted from 0, and how many there are.
  bar: number;
  bars: number;
  onCopy: (to: number[]) => void;
}

// "Copy bar": lays the bar on show over another bar of the same pattern, or over all of them. It
// is an edit to the open scene, so Undo takes it back and it does not ask first.
export default function CopyBar({ part, bar, bars, onCopy }: CopyBarProps) {
  const others = Array.from({ length: bars }, (_, index) => index).filter(index => index !== bar);
  return (
    <span className="copy-to copy-bar">
      <Menu
        label="Copy bar"
        groups={[
          others.map(to => ({ label: `To bar ${to + 1}`, title: `Put bar ${bar + 1} of ${part} over bar ${to + 1}`, onSelect: () => onCopy([to]) })),
          ...(others.length > 1 ? [[{ label: 'To every bar', title: `Put bar ${bar + 1} of ${part} over every other bar`, onSelect: () => onCopy(others) }]] : []),
        ]}
      />
    </span>
  );
}
