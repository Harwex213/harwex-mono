import { HEX_SIZE } from "./hex-layout";
import { cellOf } from "../state/grid-state";
import styles from "./blocked.module.css";

// The cross a refused hex wears, from `assets/cross.svg`: two strokes crossing
// at the hex centre, with round caps. The source draws a span of 16 units on a
// stroke of 2, and that ratio is kept here, so the icon is the same shape at the
// size a hex affords it.
//
// How far each arm reaches from the centre. A pointy-top hex is narrower than it
// is tall, so the arms are measured against the width: the corners of the cross
// clear the two slanted edges by a good margin at this reach.
const CROSS_REACH = HEX_SIZE * 0.4;
const CROSS_WIDTH = (CROSS_REACH * 2) / 8;
const CROSS_PATH = [
  `M${(-CROSS_REACH).toFixed(2)} ${(-CROSS_REACH).toFixed(2)}`,
  `L${CROSS_REACH.toFixed(2)} ${CROSS_REACH.toFixed(2)}`,
  `M${CROSS_REACH.toFixed(2)} ${(-CROSS_REACH).toFixed(2)}`,
  `L${(-CROSS_REACH).toFixed(2)} ${CROSS_REACH.toFixed(2)}`,
].join(" ");

// The hexes an armed unit may not be put down on, drawn over the terrain and
// under the unit markers. The counterpart of `PlacementLayer`: nothing is drawn
// while no unit is armed, because the layer is handed an empty list then.
function BlockedLayer({ cellKeys }: { cellKeys: string[] }) {
  return (
    <>
      {cellKeys.map((key) => (
        <BlockedHex cellKey={key} key={key} />
      ))}
    </>
  );
}

function BlockedHex({ cellKey }: { cellKey: string }) {
  const cell = cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  return (
    <path
      className={styles.cross}
      d={CROSS_PATH}
      strokeWidth={CROSS_WIDTH}
      transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
    />
  );
}

export { BlockedLayer };
