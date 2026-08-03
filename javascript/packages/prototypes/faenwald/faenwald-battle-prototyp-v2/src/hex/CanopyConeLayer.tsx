import { cellOf } from "../state/grid-state";
import { hexRegionOutline } from "./hex-layout";
import styles from "./canopy-cone.module.css";

// Where a canopy shot from the selected unit could come down: a border running
// around the cone in front of it, drawn between the hexes inside the cone and the
// hexes outside it. The hexes themselves are left as they are, so the terrain
// under the cone and every other cue the board draws on those hexes read exactly
// as they do anywhere else.
//
// Nothing is drawn while the cone is switched off, or for a unit that does not
// shoot: the layer is handed an empty list then, the way the move targets are.
// This is a view of the board and not an order on it, so nothing here takes the
// pointer — hovering the cone hovers the terrain under it, and clicking it
// selects the way any other hex does.
function CanopyConeLayer({ cellKeys }: { cellKeys: string[] }) {
  const cells: Array<{ col: number; row: number }> = [];
  for (const cellKey of cellKeys) {
    const cell = cellOf(cellKey);
    if (cell !== null) {
      cells.push(cell);
    }
  }

  // One loop per run of hexes. A cone is one solid wedge, so in practice there is
  // a single loop — the board clipping the wedge can only cut pieces off its
  // sides, never split it in two.
  //
  // The path itself is the key, so a loop is the same element for as long as it
  // is the same shape and the dashes go on marching across a re-render. A cone
  // that swings round with the unit is a new shape and starts its own march,
  // which is not something the eye can catch on a border that has just jumped.
  return (
    <>
      {hexRegionOutline(cells).map((loop) => (
        <g className={styles.cone} key={loop}>
          <path className={styles.glow} d={loop} />
          <path className={styles.edge} d={loop} />
        </g>
      ))}
    </>
  );
}

export { CanopyConeLayer };
