import { useRef, type CSSProperties } from "react";
import { HEX_INSET, HEX_SIZE, hexPoints, hexWidth } from "../hex/hex-layout";
import type { AttackDamage } from "../state/attack-strategies";
import type { Movement, Strike } from "../state/battle-state";
import { cellOf } from "../state/grid-state";
import type { Unit } from "../state/units-state";
import { ICON_VIEWBOX, SWAP_ICON, UNIT_ICONS } from "./unit-icons";
import styles from "./unit.module.css";

// The marker stops just short of the terrain hex it stands on, so that hex
// keeps its own outline — and, on the selected cell, the tick running along it.
// Every measurement below is a fraction of the marker size, so a new `HEX_SIZE`
// rescales the whole thing.
const UNIT_HEX_INSET = 5;
const UNIT_HEX_SIZE = HEX_SIZE - HEX_INSET - UNIT_HEX_INSET;
const UNIT_POINTS = hexPoints(UNIT_HEX_SIZE);

// The Оппортун ring runs in the gap the inset above leaves, rather than on the
// marker outline. Both armies wear a strong colour, and a red ring drawn on the
// red one would be a red line on a red field — out here it is drawn against the
// terrain instead, and reads the same on either side.
const OPPORTUNITY_POINTS = hexPoints(UNIT_HEX_SIZE + UNIT_HEX_INSET / 2);

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

// A turn is animated on the glyph, and a CSS transform needs somewhere to turn
// about. `fill-box` puts that in the middle of what the group draws, which is
// only the middle of the glyph if the glyph is centred on its box — and none of
// them quite are. So the group also holds an unpainted circle around the point
// the glyph is meant to turn about: a circle is its own centre, and one big
// enough to swallow the glyph makes the group's box symmetric about that point.
// Half the diagonal of the scaled viewBox is `√2 / 2` of its side, so this
// clears the glyph in every rotation.
const ICON_ANCHOR_RADIUS = ICON_SIZE * 0.75;

// The swap glyph is drawn upright and reaches the edges of its own viewBox, so it
// needs none of the diagonal arithmetic above — just a size that stays inside the
// marker it covers.
const SWAP_ICON_SCALE = (UNIT_HEX_SIZE * 1.2) / ICON_VIEWBOX;

// One handle per hex facing. A pointy-top hex has a corner in each of these
// directions, so a handle sits on the corner the unit would face.
const FACINGS = [0, 60, 120, 180, 240, 300];

// Handles ride on the marker outline, and are wide enough to be an easy target
// at the fitted zoom.
const HANDLE_RADIUS = UNIT_HEX_SIZE * 0.34;

// A dart inside the handle, drawn pointing straight up and turned to the facing
// with the handle: tip, one barb, the notch between them, the other barb.
const ARROW_LENGTH = HANDLE_RADIUS * 0.62;
const ARROW_WIDTH = HANDLE_RADIUS * 0.46;
const ARROW_POINTS = [
  `0,${(-ARROW_LENGTH).toFixed(2)}`,
  `${ARROW_WIDTH.toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
  `0,${(ARROW_LENGTH * 0.28).toFixed(2)}`,
  `${(-ARROW_WIDTH).toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
].join(" ");

// How far the arrow inside a hovered handle creeps the way it points. The
// handle is turned to its facing, so straight up in the arrow's own frame is
// outwards on the board, and the stylesheet only has to know the distance.
const ARROW_NUDGE = ARROW_LENGTH * 0.32;

const HANDLE_MOTION = {
  "--handle-nudge": `${(-ARROW_NUDGE).toFixed(2)}px`,
} as CSSProperties;

// How far the attacker leans into the blow, as a share of the distance to the
// unit it hits. Far enough to read as a lunge, short enough that the marker
// never leaves the hex it is standing on.
const PUNCH_REACH = hexWidth(HEX_SIZE) * 0.3;

type UnitLayerProps = {
  units: Unit[];
  // A unit that is not standing where it is drawn: the one being placed or
  // moved, shown on the hex under the pointer.
  preview?: Unit | null;
  // Cell of the unit a move would trade places with.
  swapCellKey?: string | null;
  // Cell of the unit being turned, which is where the handles go. The three
  // callbacks below are only ever used with it.
  rotateCellKey?: string | null;
  onFacingHover?: (facing: number | null) => void;
  onFacingPick?: (facing: number) => void;
  // The unit an armed attack is pointed at, and what the blow would take off it.
  // The marker itself is left alone — the board answers the pointer around it —
  // and the one thing it does is blink the slices of its bars it is about to
  // lose.
  threatenedUnitId?: string | null;
  threatenedDamage?: AttackDamage | null;
  // The blow being played out, if any: the attacker lunges, the unit it lands on
  // is knocked about and flashed.
  strike?: Strike | null;
  // The step being played out, if any: the unit that has moved is drawn on the
  // hex it has arrived at and slid in from the one it left.
  movement?: Movement | null;
  // The two units an open Оппортун stands between: the enemy holding the swing
  // and the unit that provoked it. Both are ringed in a pulsing red for as long
  // as the window is open, so the board says who is about to be hit and by whom
  // before anything moves.
  opportunityAttackerId?: string | null;
  opportunityVictimId?: string | null;
};

// Which end of an open Оппортун a marker is on, if either.
type OpportunityRole = "attacker" | "victim";

// World-space content for `HexCanvas`, drawn after the terrain hexes. The
// units arrive as a prop so each page can feed the layer its own roster.
function UnitLayer({
  units,
  preview,
  swapCellKey,
  rotateCellKey,
  onFacingHover,
  onFacingPick,
  threatenedUnitId,
  threatenedDamage,
  strike,
  movement,
  opportunityAttackerId,
  opportunityVictimId,
}: UnitLayerProps) {
  return (
    <>
      {units.map((unit) => (
        <UnitMarker
          damage={unit.id === threatenedUnitId ? threatenedDamage : null}
          key={unit.id}
          movement={movement}
          opportunity={opportunityRole(unit.id, opportunityAttackerId, opportunityVictimId)}
          strike={strike}
          unit={unit}
        />
      ))}
      {/* All three last, so they sit over the markers they cover. */}
      {preview === undefined || preview === null ? null : (
        <UnitMarker unit={preview} className={styles.preview} />
      )}
      {swapCellKey === undefined || swapCellKey === null ? null : (
        <SwapOverlay cellKey={swapCellKey} />
      )}
      {rotateCellKey === undefined || rotateCellKey === null ? null : (
        <RotateHandles cellKey={rotateCellKey} onHover={onFacingHover} onPick={onFacingPick} />
      )}
    </>
  );
}

// Which end of the open Оппортун this unit is on. Nothing at all with no window
// open, which is what the two ids being absent stands for.
function opportunityRole(
  unitId: string,
  attackerId: string | null | undefined,
  victimId: string | null | undefined,
): OpportunityRole | null {
  if (unitId === attackerId) {
    return "attacker";
  }

  if (unitId === victimId) {
    return "victim";
  }

  return null;
}

// A circle on every corner of the marker, each carrying an arrow that points the
// way the unit would face.
function RotateHandles({
  cellKey,
  onHover,
  onPick,
}: {
  cellKey: string;
  onHover?: (facing: number | null) => void;
  onPick?: (facing: number) => void;
}) {
  const cell = cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  return (
    <g transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}>
      {FACINGS.map((facing) => {
        // Facing is clockwise from straight up, and the y axis points down.
        const radians = (Math.PI / 180) * facing;
        const x = UNIT_HEX_SIZE * Math.sin(radians);
        const y = -UNIT_HEX_SIZE * Math.cos(radians);

        // Handlers on the group, not the circle: the arrow lies over the circle,
        // and a pointer that crosses onto it must not read as leaving the handle.
        // `rotate` turns the arrow to the facing; the circle does not mind.
        return (
          <g
            className={styles.handle}
            key={facing}
            onClick={() => onPick?.(facing)}
            onPointerEnter={() => onHover?.(facing)}
            onPointerLeave={() => onHover?.(null)}
            style={HANDLE_MOTION}
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${facing})`}
          >
            {/* A ring under the disc, at the same size, which the pointer sends
                pulsing out past it. Drawn first so the disc covers it while the
                handle is at rest. */}
            <circle className={styles.handleHalo} r={HANDLE_RADIUS.toFixed(2)} />
            <circle className={styles.handleDisc} r={HANDLE_RADIUS.toFixed(2)} />
            <polygon className={styles.handleArrow} points={ARROW_POINTS} />
          </g>
        );
      })}
    </g>
  );
}

// Washes out the marker on `cellKey` and stamps the swap glyph on it.
function SwapOverlay({ cellKey }: { cellKey: string }) {
  const cell = cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  return (
    <g className={styles.swap} transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}>
      <polygon className={styles.swapScrim} points={UNIT_POINTS} />
      {/* Same reading as the unit glyph: centred on its viewBox, then scaled. */}
      <path
        className={styles.swapGlyph}
        d={SWAP_ICON.path}
        strokeWidth={SWAP_ICON.strokeWidth}
        transform={`scale(${SWAP_ICON_SCALE.toFixed(4)}) translate(${-ICON_VIEWBOX / 2} ${-ICON_VIEWBOX / 2})`}
      />
    </g>
  );
}

function UnitMarker({
  unit,
  className,
  damage,
  strike,
  movement,
  opportunity,
}: {
  unit: Unit;
  className?: string;
  damage?: AttackDamage | null;
  strike?: Strike | null;
  movement?: Movement | null;
  opportunity?: OpportunityRole | null;
}) {
  // Called before the early return below, because a hook cannot be skipped. The
  // angle it keeps belongs to the unit, not to the hex it stands on.
  const angle = useTurnedAngle(unit.facing ?? 0);

  const cell = cellOf(unit.cellKey);
  if (cell === null) {
    return null;
  }

  const icon = UNIT_ICONS[unit.kind];
  const blow = strike ?? null;
  const attacking = blow !== null && blow.attackerId === unit.id;
  // A blow landed by hand is a lunge. A volley is loosed instead: the shooter
  // leans back into the draw and settles while its arrow crosses the board, and
  // never leaves the hex it is standing on.
  const punching = attacking && blow.kind === "melee";
  const shooting = attacking && blow.kind === "canopy" && blow.phase === "flight";
  // The unit under the blow answers when the blow arrives. For a lunge that is
  // the moment it is committed — the lunge carries its own wind-up. For a volley
  // it is the moment the arrow comes down, so the marker stands still while the
  // arrow is in the air and `landed` cuts the wind-up the keyframes open with.
  const struck = blow !== null && blow.targetId === unit.id && blow.phase === "impact";
  const landed = struck && blow.kind === "canopy";

  // The lunge is a CSS animation, and a CSS transform on the group would throw
  // away the `transform` attribute that puts the marker on its hex. So the
  // translate stays on the outer group and everything that animates hangs off an
  // inner one. A facing is clockwise from straight up, and the y axis points
  // down, which is where the sign on the second line comes from.
  const radians = blow === null ? 0 : (Math.PI / 180) * blow.direction;

  // Where the step started, as an offset from the hex the unit now stands on.
  // The animation opens the marker there and brings it home.
  const stepping = movement !== undefined && movement !== null && movement.unitId === unit.id;
  const from = stepping ? cellOf(movement.fromKey) : null;

  const motionStyle = {
    "--punch-dx": `${(PUNCH_REACH * Math.sin(radians)).toFixed(2)}px`,
    "--punch-dy": `${(-PUNCH_REACH * Math.cos(radians)).toFixed(2)}px`,
    "--step-dx": from === null ? "0px" : `${(from.x - cell.x).toFixed(2)}px`,
    "--step-dy": from === null ? "0px" : `${(from.y - cell.y).toFixed(2)}px`,
  } as CSSProperties;

  const bodyClass = [
    styles.marker,
    punching ? styles.punching : "",
    shooting ? styles.shooting : "",
    struck ? styles.struck : "",
    landed ? styles.landed : "",
    from === null ? "" : styles.stepping,
  ]
    .filter((part) => part !== "")
    .join(" ");

  // Keyed on whatever is being played out, so a unit that strikes or steps twice
  // in a row plays the animation twice: same class, same element, and CSS would
  // run it once. A blow wins the slot, because a unit cannot be told to strike
  // and to step at the same time — only one order is armed.
  let replayKey = "still";
  if (punching || shooting || struck) {
    replayKey = `strike-${blow?.seq}`;
  } else if (from !== null) {
    replayKey = `step-${movement?.seq}`;
  }

  return (
    <g
      className={className === undefined ? styles.unit : `${styles.unit} ${className}`}
      transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
    >
      <g className={bodyClass} key={replayKey} style={motionStyle}>
        {/* Everything the marker draws, under one more group. A CSS animation
            replaces the whole transform of the element it runs on, so the hop a
            step is carried over the gap with has nowhere to go on the group
            above — that one is busy walking the marker across. See `.stepLift`. */}
        <g className={styles.stepLift}>
          <polygon className={`${styles.body} ${styles[unit.side]}`} points={UNIT_POINTS} />
          {/* The glyph is the only part of the marker that says which way the
              unit faces, so a turn is animated on it alone: the bars and the
              plates stand still while it comes round. The outer group drops it
              into the middle of the band left for it, the inner one carries the
              turn, and the path reads right to left as before — centred on its
              own viewBox, scaled, then stood upright. */}
          <g transform={`translate(0 ${ICON_CENTER_Y.toFixed(2)})`}>
            <g className={styles.iconTurn} style={{ transform: `rotate(${angle}deg)` }}>
              <circle className={styles.iconAnchor} r={ICON_ANCHOR_RADIUS.toFixed(2)} />
              <path
                className={styles.icon}
                d={icon.path}
                transform={`rotate(${icon.rotation}) scale(${ICON_SCALE}) translate(${-ICON_VIEWBOX / 2} ${-ICON_VIEWBOX / 2})`}
              />
            </g>
          </g>
          <StatBar
            doomed={damage?.health ?? 0}
            fillClass={styles.health}
            value={unit.stats.health}
            x={-BAR_OFFSET}
          />
          <StatBar
            doomed={damage?.morale ?? 0}
            fillClass={styles.morale}
            value={unit.stats.morale}
            x={BAR_OFFSET}
          />
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
          {/* The two below are last, so they lie over the whole marker.
              The wash a blow lands with, mounted only for the length of the
              animation. */}
          {struck ? <polygon className={styles.flash} points={UNIT_POINTS} /> : null}
          {/* The Оппортун ring. Drawn as a shape of its own rather than as
              anything on the marker: the marker may be stepping or lunging at
              the same moment, and the two must not fight over one transform. */}
          {opportunity === undefined || opportunity === null ? null : (
            <>
              {/* The unit the swing is aimed at takes the colour over the whole
                  of it as well. The ring says an Оппортун is open; the wash says
                  which end of it this marker is on. */}
              {opportunity === "victim" ? (
                <polygon className={styles.opportunityWash} points={UNIT_POINTS} />
              ) : null}
              {/* A dark ring under the red one, at a weight that leaves the red
                  showing through the middle of it. The gap the ring runs in is a
                  couple of px of whatever terrain the unit stands on, and the
                  board has five of those to read against. */}
              <polygon className={styles.opportunityShade} points={OPPORTUNITY_POINTS} />
              <polygon
                className={`${styles.opportunity} ${
                  opportunity === "victim" ? styles.opportunityVictim : styles.opportunityAttacker
                }`}
                points={OPPORTUNITY_POINTS}
              />
            </>
          )}
        </g>
      </g>
    </g>
  );
}

// The angle the glyph is drawn at, which is not the facing it stands for. A
// facing runs 0 to 300 and wraps, so a unit turning from 300 to 0 has turned 60
// degrees to the right — while the number it is drawn at fell by 300, and the
// animation would carry it the long way round. So the drawn angle is kept here
// and only ever moved by the shorter of the two ways to the new facing, which
// leaves it free to run past 360 or below zero.
//
// Written during the render that reads it: the value is worked out from the
// facing handed in rather than held as state, so there is nothing to re-render
// for. A render the facing slept through leaves it where it was.
function useTurnedAngle(facing: number): number {
  const angle = useRef(facing);
  const drawnFacing = useRef(facing);

  if (drawnFacing.current !== facing) {
    angle.current += shorterTurn(drawnFacing.current, facing);
    drawnFacing.current = facing;
  }

  return angle.current;
}

// Degrees from one facing to another, taking whichever way round is shorter.
// Positive is clockwise. Two opposite facings are the same distance either way,
// and this takes them counter-clockwise.
function shorterTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
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
//
// `doomed` is how much of the value a blow under the pointer would take. That
// much of the fill, counted down from its top, is blinked to the empty track
// colour — the bar drains and comes back for as long as the pointer rests on
// the unit, which is what says the blow has not landed yet.
function StatBar({
  x,
  value,
  doomed = 0,
  fillClass,
}: {
  x: number;
  value: number;
  doomed?: number;
  fillClass: string;
}) {
  const ratio = clampRatio(value / STAT_MAX);
  const fillHeight = BAR_HEIGHT * ratio;
  // A blow bigger than what is left takes what is left, so the slice never runs
  // past the top of the fill.
  const doomedHeight = BAR_HEIGHT * Math.min(clampRatio(doomed / STAT_MAX), ratio);

  return (
    <g transform={`translate(${x.toFixed(2)} 0)`}>
      <rect
        className={styles.barTrack}
        x={-BAR_WIDTH / 2}
        y={-BAR_HEIGHT / 2}
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
      />
      {/* Drawn at full height and squashed to the value, rather than drawn at
          the value: a height is a geometry attribute and not every browser
          transitions one, while every browser transitions a transform. That is
          what lets the bar slide down as a blow lands instead of jumping. */}
      <rect
        className={`${styles.barFill} ${fillClass}`}
        x={-BAR_WIDTH / 2}
        y={-BAR_HEIGHT / 2}
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
        style={{ transform: `scaleY(${ratio.toFixed(4)})` }}
      />
      {doomedHeight === 0 ? null : (
        <rect
          className={styles.barDoomed}
          x={-BAR_WIDTH / 2}
          y={BAR_HEIGHT / 2 - fillHeight}
          width={BAR_WIDTH}
          height={doomedHeight}
        />
      )}
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

function clampRatio(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export { UnitLayer };
