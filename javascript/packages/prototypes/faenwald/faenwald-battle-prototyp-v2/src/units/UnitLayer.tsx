import { HEX_INSET, HEX_SIZE, hexPoints, hexWidth } from "../hex/hex-layout";
import { cellOf } from "../state/grid-state";
import type { Unit } from "../state/units-state";
import { ICON_VIEWBOX, UNIT_ICONS } from "./unit-icons";
import styles from "./unit.module.css";

// The marker stops just short of the terrain hex it stands on, so that hex
// keeps its own outline — and, on the selected cell, the tick running along it.
// Every measurement below is a fraction of the marker size, so a new `HEX_SIZE`
// rescales the whole thing.
const UNIT_HEX_INSET = 5;
const UNIT_HEX_SIZE = HEX_SIZE - HEX_INSET - UNIT_HEX_INSET;
const UNIT_POINTS = hexPoints(UNIT_HEX_SIZE);

// Health on the left of the marker, morale on the right. Both stats are read as
// a percentage, so a full bar means 100.
const STAT_MAX = 100;
// A pointy-top hex has a vertical side of exactly one circumradius, so a bar of
// that height covers the whole flat edge it sits on.
const BAR_HEIGHT = UNIT_HEX_SIZE;
const BAR_WIDTH = UNIT_HEX_SIZE * 0.22;
// Half the hex width is the distance from the centre to that flat edge, so this
// lays the bar against the edge from the inside: its outer face runs along the
// marker outline.
const BAR_OFFSET = hexWidth(UNIT_HEX_SIZE) / 2 - BAR_WIDTH / 2;

// Attack rides in the top corner of the marker, the unit code in the bottom
// one. Both plates keep their text readable on either side colour, the way the
// bar track does.
const DAMAGE_PLATE_WIDTH = UNIT_HEX_SIZE * 0.36;
const DAMAGE_FONT_SIZE = UNIT_HEX_SIZE * 0.23;
// Wider than the damage plate: the longest code in the roster runs four
// characters.
const NAME_PLATE_WIDTH = UNIT_HEX_SIZE * 0.58;
const NAME_FONT_SIZE = UNIT_HEX_SIZE * 0.2;
const PLATE_HEIGHT = UNIT_HEX_SIZE * 0.26;
// Room left for the two outlines that meet in a corner — the plate's own and
// the marker's.
const PLATE_MARGIN = 2;

// A corner of the hex is a point, and the edges running out of it gain √3 of
// half-width per unit of travel — `hexWidth(1)` is that √3. So this is how far
// from the corner a plate of the given width first fits.
function plateInset(width: number): number {
  return (width / 2 + PLATE_MARGIN) / hexWidth(1);
}

const DAMAGE_PLATE_Y = -UNIT_HEX_SIZE + plateInset(DAMAGE_PLATE_WIDTH) + PLATE_HEIGHT / 2;
const NAME_PLATE_Y = UNIT_HEX_SIZE - plateInset(NAME_PLATE_WIDTH) - PLATE_HEIGHT / 2;

// What the glyph has left: the bars fence it in on the sides, the two plates
// above and below. Both glyphs run corner to corner across their viewBox, which
// means a turned one reaches the box diagonal — dividing by √2 keeps every
// facing inside that box.
const ICON_CLEARANCE = UNIT_HEX_SIZE * 0.03;
const ICON_FREE_WIDTH = 2 * (BAR_OFFSET - BAR_WIDTH / 2 - ICON_CLEARANCE);
const ICON_TOP = DAMAGE_PLATE_Y + PLATE_HEIGHT / 2 + ICON_CLEARANCE;
const ICON_BOTTOM = NAME_PLATE_Y - PLATE_HEIGHT / 2 - ICON_CLEARANCE;
// The plates are not the same size, so the free band is off centre.
const ICON_CENTER_Y = (ICON_TOP + ICON_BOTTOM) / 2;
const ICON_SPAN = Math.min(ICON_FREE_WIDTH, ICON_BOTTOM - ICON_TOP);
// Neither glyph reaches all the way into the corners of its viewBox: measured
// against the source paths, the drawn shape covers about this much of the box
// diagonal. Dividing it back out is what stops the icon from coming out too
// small for the space it was given.
const GLYPH_REACH = 0.85;
// World-px size the source viewBox is scaled to.
const ICON_SIZE = ICON_SPAN / (Math.SQRT2 * GLYPH_REACH);
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
          then scaled, then turned upright — plus whichever way the unit faces —
          and last dropped into the middle of the band left for it. */}
      <path
        className={styles.icon}
        d={icon.path}
        transform={`translate(0 ${ICON_CENTER_Y.toFixed(2)}) rotate(${icon.rotation + (unit.facing ?? 0)}) scale(${ICON_SCALE}) translate(${-ICON_VIEWBOX / 2} ${-ICON_VIEWBOX / 2})`}
      />
      <StatBar x={-BAR_OFFSET} value={unit.stats.health} fillClass={styles.health} />
      <StatBar x={BAR_OFFSET} value={unit.stats.morale} fillClass={styles.morale} />
      <Plate
        y={DAMAGE_PLATE_Y}
        width={DAMAGE_PLATE_WIDTH}
        fontSize={DAMAGE_FONT_SIZE}
        label={String(unit.stats.attack)}
      />
      <Plate
        y={NAME_PLATE_Y}
        width={NAME_PLATE_WIDTH}
        fontSize={NAME_FONT_SIZE}
        label={unit.name}
      />
    </g>
  );
}

// A label in a corner of the marker: a light rounded plate with the text
// centred on it.
function Plate({
  y,
  width,
  fontSize,
  label,
}: {
  y: number;
  width: number;
  fontSize: number;
  label: string;
}) {
  return (
    <>
      <rect
        className={styles.plate}
        x={-width / 2}
        y={y - PLATE_HEIGHT / 2}
        width={width}
        height={PLATE_HEIGHT}
        rx={PLATE_HEIGHT * 0.25}
      />
      <text className={styles.plateText} x={0} y={y} fontSize={fontSize.toFixed(1)}>
        {label}
      </text>
    </>
  );
}

// A vertical gauge drawn around (`x`, 0): an empty track, a fill that grows from
// the bottom, and the outline last so the fill never paints over it.
function StatBar({ x, value, fillClass }: { x: number; value: number; fillClass: string }) {
  const ratio = Math.min(Math.max(value / STAT_MAX, 0), 1);
  const fillHeight = BAR_HEIGHT * ratio;

  return (
    <g transform={`translate(${x.toFixed(2)} 0)`}>
      <rect
        className={styles.barTrack}
        x={-BAR_WIDTH / 2}
        y={-BAR_HEIGHT / 2}
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
      />
      <rect
        className={fillClass}
        x={-BAR_WIDTH / 2}
        y={BAR_HEIGHT / 2 - fillHeight}
        width={BAR_WIDTH}
        height={fillHeight}
      />
      <rect
        className={styles.barFrame}
        x={-BAR_WIDTH / 2}
        y={-BAR_HEIGHT / 2}
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
      />
    </g>
  );
}

export { UnitLayer };
