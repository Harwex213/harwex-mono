import { hexPoints } from "../hex/hex-layout";
import { cellOf } from "../state/grid-state";
import type { Unit } from "../state/units-state";
import { ICON_VIEWBOX, UNIT_ICONS } from "./unit-icons";
import styles from "./unit.module.css";

// The unit hex is smaller than the terrain hex it stands on, so a ring of
// terrain stays visible around the marker.
const UNIT_HEX_SIZE = 26;
const UNIT_POINTS = hexPoints(UNIT_HEX_SIZE);

// World-px size the source viewBox is scaled to. Both glyphs run corner to
// corner across it, so the upright glyph ends up taller than this number.
const ICON_SIZE = 40;
const ICON_SCALE = ICON_SIZE / ICON_VIEWBOX;

// World-space content for `HexCanvas`, drawn after the terrain hexes. The
// units arrive as a prop so each page can feed the layer its own roster.
function UnitLayer({ units }: { units: Unit[] }) {
  return (
    <>
      {units.map((unit) => (
        <UnitMarker key={unit.id} unit={unit} />
      ))}
    </>
  );
}

function UnitMarker({ unit }: { unit: Unit }) {
  const cell = cellOf(unit.cellKey);
  if (cell === null) {
    return null;
  }

  const icon = UNIT_ICONS[unit.kind];

  return (
    <g className={styles.unit} transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}>
      <polygon className={`${styles.body} ${styles[unit.side]}`} points={UNIT_POINTS} />
      {/* Read right to left: the glyph is centred on its own viewBox first,
          then scaled, then turned upright. */}
      <path
        className={styles.icon}
        d={icon.path}
        transform={`rotate(${icon.rotation}) scale(${ICON_SCALE}) translate(${-ICON_VIEWBOX / 2} ${-ICON_VIEWBOX / 2})`}
      />
    </g>
  );
}

export { UnitLayer };
