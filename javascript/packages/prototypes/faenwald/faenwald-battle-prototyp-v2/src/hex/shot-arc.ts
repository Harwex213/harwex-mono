// The path a lobbed shot takes across the board, worked out once and read by
// both the layer that offers the shot and the layer that plays it out. The
// dashed curve under the pointer and the arrow that flies along it are then the
// same line, drawn twice.
//
// The board is seen from above, where a shot over somebody's head would be a
// straight line and say nothing. So the flight is bowed sideways instead: the
// curve is what says the arrow went over the units in the way rather than
// through them.

// How far the flight leaves the straight line between the two hexes, as a share
// of the distance between them. This is the offset of the control point, and a
// quadratic curve only reaches half of it — so the arrow's widest point sits
// half this far off the line.
const ARC_LIFT = 0.2;

// Either end of the flight, in world coordinates. A hex centre answers this, and
// so does a point worked out beside one — the arc knows nothing about hexes.
type ShotPoint = {
  x: number;
  y: number;
};

type ShotArc = {
  // The whole curve, for a `<path>` from the attacker's hex to the target's.
  path: string;
  // The straight run between the two hexes, which the flight is timed along.
  chordX: number;
  chordY: number;
  // The offset of the control point, off to one side of that run. A point on the
  // curve is the straight run plus this much of it — `2t(1 - t)` of it at a time
  // — which is what lets the flight be animated as two translations in a row.
  arcX: number;
  arcY: number;
};

function shotArc(from: ShotPoint, to: ShotPoint): ShotArc {
  const chordX = to.x - from.x;
  const chordY = to.y - from.y;
  const distance = Math.hypot(chordX, chordY);

  // Square to the flight, and to the same side of it every time. A shot with
  // nowhere to travel has no side to bow to either, and is drawn as the straight
  // line it is.
  const lift = distance * ARC_LIFT;
  const arcX = distance === 0 ? 0 : (chordY / distance) * lift;
  const arcY = distance === 0 ? 0 : (-chordX / distance) * lift;

  // Written from the attacker's hex, so the path element is placed the same way
  // the flying arrow is: translated onto that hex and drawn from zero.
  const controlX = chordX / 2 + arcX;
  const controlY = chordY / 2 + arcY;
  const path = [
    "M 0 0",
    `Q ${controlX.toFixed(2)} ${controlY.toFixed(2)}`,
    `${chordX.toFixed(2)} ${chordY.toFixed(2)}`,
  ].join(" ");

  return { path, chordX, chordY, arcX, arcY };
}

export { shotArc };
export type { ShotArc, ShotPoint };
