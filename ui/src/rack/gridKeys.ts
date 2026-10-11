// Where an arrow key, Home or End takes the keyboard in a grid of step buttons that has one
// tab stop. `lanes` is the grid's buttons, one list for each lane, in the order they are in the
// page; a lane may wrap over several lines on a narrow screen, which is read from where its
// buttons are. Left and right stay in the lane, Home and End go to its ends, and up and down go
// to the line above or below, into the next lane when the lane has no more lines. Returns the
// button to focus, or nothing when the key is not one of these or there is nowhere to go.
export function gridKeyTarget(key: string, lanes: HTMLElement[][], from: HTMLElement): HTMLElement | null {
  const lane = lanes.findIndex(cells => cells.includes(from));
  if (lane < 0) return null;
  const cells = lanes[lane];
  const at = cells.indexOf(from);
  const perLine = Math.max(1, cells.filter(cell => cell.offsetTop === cells[0].offsetTop).length);
  if (key === 'ArrowLeft') return cells[at - 1] ?? null;
  if (key === 'ArrowRight') return cells[at + 1] ?? null;
  if (key === 'Home') return at === 0 ? null : cells[0];
  if (key === 'End') return at === cells.length - 1 ? null : cells[cells.length - 1];
  if (key === 'ArrowUp') {
    if (at - perLine >= 0) return cells[at - perLine];
    const above = lanes[lane - 1];
    // The last line of the lane above, in the same column.
    return above ? above[Math.floor((above.length - 1) / perLine) * perLine + (at % perLine)] ?? above[above.length - 1] : null;
  }
  if (key === 'ArrowDown') {
    if (at + perLine < cells.length) return cells[at + perLine];
    const below = lanes[lane + 1];
    return below ? below[at % perLine] ?? below[0] : null;
  }
  return null;
}
