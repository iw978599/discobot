// Whether a change starts a new undo step. A run of changes close together (a knob being
// turned) is one step: each is measured against the change before it, not against the last
// step. A control that has not been changed before always starts one, however soon after the
// page loaded: the clock starts at zero then, and "no change yet" must not read as "a change
// at zero".
export function startsUndoStep(lastChange: number | undefined, now: number, minIntervalMs: number): boolean {
  return lastChange === undefined || now - lastChange >= minIntervalMs;
}
