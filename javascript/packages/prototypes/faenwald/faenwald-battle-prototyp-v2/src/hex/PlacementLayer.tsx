import { HEX_FILL_POINTS } from "./hex-layout";
import { cellOf } from "../state/grid-state";
import styles from "./placement.module.css";

// The hexes an armed unit may be put down on, drawn over the terrain and under
// the unit markers. Nothing is drawn while no unit is armed: the layer is handed
// an empty list then.
function PlacementLayer({ cellKeys }: { cellKeys: string[] }) {
  return (
    <>
      {cellKeys.map((key) => (
        <PlacementHex cellKey={key} key={key} />
      ))}
    </>
  );
}

function PlacementHex({ cellKey }: { cellKey: string }) {
  const cell = cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  // The fill carries the cell key and takes the pointer itself, so the canvas
  // reads the same hex off it that the terrain underneath would have given — and
  // the hover cue is then plain CSS.
  return (
    <polygon
      className={styles.fill}
      data-cell-key={cellKey}
      points={HEX_FILL_POINTS}
      transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
    />
  );
}

export { PlacementLayer };
