// The only distance the sim is allowed to measure, and the reason is lockstep.
//
// `Math.hypot` and `x ** 2` are *implementation-approximated* in the spec: two
// engines (or two versions of one) may answer differently in the last bit, and
// nothing in the standard says otherwise. One bit is enough to flip a `<= REACH`, to
// reorder two haul candidates a hair apart, or to move a lake by a tile at mapgen —
// and one flipped decision is a world that has parted ways with the other clients'
// for good. `+`, `-`, `*` and `Math.sqrt` are exact per IEEE-754, so they are the
// shapes used here.
//
// Squared distance is the default: comparing and sorting never needs the root, and
// the root is the only part that could ever cost precision.

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

export { dist, dist2 };
