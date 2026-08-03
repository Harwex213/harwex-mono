import { cellOf } from "../state/grid-state";
import { HEX_FILL_POINTS } from "./hex-layout";
import styles from "./canopy-cone.module.css";

// Where a canopy shot from the selected unit could come down: the cone in front
// of it, washed over in green. Drawn under the markers, so a unit standing in the
// cone is still read as a unit rather than as part of the wash.
//
// Nothing is drawn while the cone is switched off, or for a unit that does not
// shoot: the layer is handed an empty list then, the way the move targets are.
// This is a view of the board and not an order on it, so no hex here takes the
// pointer — hovering the cone hovers the terrain under it, and clicking it
// selects the way any other hex does.
function CanopyConeLayer({ cellKeys }: { cellKeys: string[] }) {
  return (
    <>
      {cellKeys.map((cellKey) => (
        <CanopyConeHex cellKey={cellKey} key={cellKey} />
      ))}
    </>
  );
}

function CanopyConeHex({ cellKey }: { cellKey: string }) {
  const cell = cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  return (
    <polygon
      className={styles.fill}
      points={HEX_FILL_POINTS}
      transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
    />
  );
}

export { CanopyConeLayer };
