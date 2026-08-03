import type { CSSProperties } from "react";
import type { Strike } from "../state/battle-state";
import { cellOf } from "../state/grid-state";
import { HEX_SIZE } from "./hex-layout";
import { shotArc } from "./shot-arc";
import styles from "./projectile.module.css";

// The arrow itself: tip, one barb, the notch between them, the other barb — the
// dart every other cue on the board is drawn with, at a slimmer cut. Pointing
// straight up, and turned to the way the shot travels.
const BOLT_LENGTH = HEX_SIZE * 0.34;
const BOLT_WIDTH = HEX_SIZE * 0.11;
const BOLT_POINTS = [
  `0,${(-BOLT_LENGTH).toFixed(2)}`,
  `${BOLT_WIDTH.toFixed(2)},${(BOLT_LENGTH * 0.62).toFixed(2)}`,
  `0,${(BOLT_LENGTH * 0.2).toFixed(2)}`,
  `${(-BOLT_WIDTH).toFixed(2)},${(BOLT_LENGTH * 0.62).toFixed(2)}`,
].join(" ");

// The arrow in the air, over everything else on the board. Drawn only while a
// shot is on its way: a blow landed by hand has nothing to fly, and a shot that
// has arrived is a unit being thrown rather than an arrow being carried.
//
// The whole flight is three transforms in a row, one group each, because a CSS
// animation replaces the entire transform of the element it runs on:
//
//   - the outer group is put on the shooter's hex and travels the straight run to
//     the target at a steady pace;
//   - the next one carries the arrow off to the side of that run and back, which
//     is what bends the flight into the curve the hover feedback drew;
//   - the last one grows the arrow towards the middle of the flight, which is the
//     one thing a board seen from above can say about height.
//
// The turn to the bearing is an attribute on a group of its own, under the three
// that animate: a transform written by CSS on any of them would throw it away.
function ProjectileLayer({ strike }: { strike: Strike | null }) {
  if (strike === null || strike.kind !== "canopy" || strike.phase !== "flight") {
    return null;
  }

  const from = cellOf(strike.fromKey);
  const to = cellOf(strike.toKey);
  if (from === null || to === null) {
    return null;
  }

  const arc = shotArc(from, to);

  const motionStyle = {
    "--shot-dx": `${arc.chordX.toFixed(2)}px`,
    "--shot-dy": `${arc.chordY.toFixed(2)}px`,
    "--shot-arc-x": `${arc.arcX.toFixed(2)}px`,
    "--shot-arc-y": `${arc.arcY.toFixed(2)}px`,
  } as CSSProperties;

  // Keyed on the shot, so two volleys in a row play the animation twice rather
  // than leaving the second one with a finished element — the same reason a
  // marker keys its lunge.
  return (
    <g
      className={styles.shot}
      key={strike.seq}
      style={motionStyle}
      transform={`translate(${from.x.toFixed(2)} ${from.y.toFixed(2)})`}
    >
      <g className={styles.travel}>
        <g className={styles.arc}>
          <g className={styles.rise}>
            <g transform={`rotate(${strike.direction.toFixed(2)})`}>
              <polygon className={styles.bolt} points={BOLT_POINTS} />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

export { ProjectileLayer };
