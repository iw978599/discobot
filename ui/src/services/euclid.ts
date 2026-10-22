// Euclidean rhythms: `hits` spread as evenly as `steps` allow, the first on the first step. Many
// of the world's common rhythms are these (3 in 8 is the tresillo, 5 in 8 the cinquillo), and
// moving one along with the drums' Shift gives the rest. This is the even-spacing form, which
// gives Bjorklund's rhythms, each started at a hit of its own (5 in 8 comes out x.x.xx.x).
export function euclid(hits: number, steps: number): boolean[] {
  const length = Math.max(0, Math.floor(steps)), count = Math.max(0, Math.min(length, Math.floor(hits)));
  return Array.from({ length }, (_, index) => count > 0 && Math.floor(index * count / length) !== Math.floor((index - 1) * count / length));
}

// The hit counts offered for a bar of `steps`: every count from two to one short of all.
export const euclidCounts = (steps: number) => Array.from({ length: Math.max(0, steps - 2) }, (_, index) => index + 2).filter(count => count < steps);
