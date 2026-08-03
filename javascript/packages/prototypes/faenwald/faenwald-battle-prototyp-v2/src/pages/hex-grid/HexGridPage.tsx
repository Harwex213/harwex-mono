import { Button } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useRef } from "react";
import { playUnitSelect } from "../../audio/sounds";
import { HexCanvas, type HexCanvasHandle } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { HexInfoPanel } from "../../hex/HexInfoPanel";
import {
  COLS,
  ROWS,
  grid,
  hoverCell,
  selectCell,
  selectedCell,
  selectedKey,
  terrainOf,
} from "../../state/grid-state";
import { unitAt, units } from "../../state/units-state";
import { UnitLayer } from "../../units/UnitLayer";
import styles from "./hex-grid-page.module.css";

function HexGridPage() {
  useSignals();

  const canvasRef = useRef<HexCanvasHandle>(null);
  const cell = selectedCell.value;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.status}>
          {cell === null
            ? `${COLS} × ${ROWS} hexes — click one to select it`
            : `col ${cell.col}, row ${cell.row} — ${terrainOf(cell.key)}`}
        </span>
        <span className={styles.hint}>Drag to pan, scroll to zoom</span>
        <Button.Root size="sm" variant="secondary" onClick={() => canvasRef.current?.fit()}>
          Fit
        </Button.Root>
      </div>

      <div className={styles.canvas}>
        <HexCanvas
          handleRef={canvasRef}
          onCellClick={selectOccupiedCell}
          onCellHover={hoverCell}
          world={grid.bounds}
        >
          <HexGridLayer>
            <UnitLayer units={units.value} />
          </HexGridLayer>
        </HexCanvas>
        <HexInfoPanel unitAt={unitAt} />
      </div>
    </div>
  );
}

// Only a hex with a unit on it can be selected here. A click on an empty one is
// dropped rather than clearing the selection, so the panel keeps showing the
// unit while the pointer wanders over the board. Placing units is the
// disposition page's job, and that one still selects any cell.
function selectOccupiedCell(key: string): void {
  if (unitAt(key) === null) {
    return;
  }

  selectCell(key);

  // The sound answers the selection, not the click. `selectCell` toggles, so a
  // second click on the selected unit lets it go, and a unit being let go has no
  // selection to answer.
  if (selectedKey.value === key) {
    playUnitSelect();
  }
}

export { HexGridPage };
