import { createContext } from 'react';

// The parameters of the lane a knob is in that its pattern holds automation for, by their names
// in `LANE_PARAMS`. A knob that says which parameter it is (`param`) marks itself when it is one
// of them: while the song plays, steps of the pattern set it, so it can sound different from
// where the knob points.
export const AutomatedParams = createContext<ReadonlySet<string>>(new Set());
export const AUTOMATED_HINT = 'Automated: while the song plays, steps of this lane’s pattern set this. The knob is what plays on the steps that have no value. See Automation under the lane’s steps.';
