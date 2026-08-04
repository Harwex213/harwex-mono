import { HEX_FILL_POINTS, HEX_SIZE } from "./hex-layout";
import type { MoveTarget } from "../state/battle-state";
import { cellOf } from "../state/grid-state";
import styles from "./move-target.module.css";

// The dart the rotation handles carry, drawn at the size a whole hex affords:
// tip, one barb, the notch between them, the other barb. Pointing straight up,
// and turned to the direction the step goes in.
const ARROW_LENGTH = HEX_SIZE * 0.42;
const ARROW_WIDTH = HEX_SIZE * 0.3;
const ARROW_POINTS = [
  `0,${(-ARROW_LENGTH).toFixed(2)}`,
  `${ARROW_WIDTH.toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
  `0,${(ARROW_LENGTH * 0.28).toFixed(2)}`,
  `${(-ARROW_WIDTH).toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
].join(" ");

// The hexes an armed move may go to, drawn over the terrain and under the unit
// markers. Nothing is drawn while no move is armed: the layer is handed an
// empty list then.
function MoveTargetLayer({ targets }: { targets: MoveTarget[] }) {
  return (
    <>
      {targets.map((target) => (
        <MoveTargetHex key={target.key} target={target} />
      ))}
    </>
  );
}

function MoveTargetHex({ target }: { target: MoveTarget }) {
  const cell = cellOf(target.key);
  if (cell === null) {
    return null;
  }

  // The fill carries the cell key and takes the pointer itself, so the canvas
  // reads the same hex off it that the terrain underneath would have given —
  // and the hover state is then plain CSS. The arrow lies over the fill and
  // lets the pointer through, or crossing onto it would read as leaving the hex.
  return (
    <g
      className={styles.target}
      transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
    >
      <polygon className={styles.fill} data-cell-key={target.key} points={HEX_FILL_POINTS} />
      <g transform={`rotate(${target.direction})`}>
        <polygon className={styles.arrow} points={ARROW_POINTS} />
      </g>
    </g>
  );
}

export { MoveTargetLayer };
