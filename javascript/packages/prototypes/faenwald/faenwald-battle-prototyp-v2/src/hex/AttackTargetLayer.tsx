import type { AttackKind, AttackTarget } from "../state/attack-strategies";
import { cellOf } from "../state/grid-state";
import { HEX_INSET, HEX_SIZE, hexPoints, hexWidth } from "./hex-layout";
import { shotArc } from "./shot-arc";
import styles from "./attack-target.module.css";

// The whole hex, less its own outline: the shape that takes the pointer over a
// unit the attack may hit. A marker lets clicks through to the terrain under
// it, so without this the target hex would answer as any other hex does.
const HIT_POINTS = hexPoints(HEX_SIZE - HEX_INSET);

// The dart pointing at the target: tip, one barb, the notch between them, the
// other barb. Drawn pointing straight up and turned to the direction the blow
// travels in, the same way a move arrow is.
const ARROW_LENGTH = HEX_SIZE * 0.38;
const ARROW_WIDTH = HEX_SIZE * 0.3;
const ARROW_POINTS = [
  `0,${(-ARROW_LENGTH).toFixed(2)}`,
  `${ARROW_WIDTH.toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
  `0,${(ARROW_LENGTH * 0.28).toFixed(2)}`,
  `${(-ARROW_WIDTH).toFixed(2)},${(ARROW_LENGTH * 0.72).toFixed(2)}`,
].join(" ");

// How far back from the target the dart sits, measured along the way the blow
// travels. One hex width is the distance between two neighbouring centres, so
// for a blow landed by hand this is the seam the blow crosses — and for a shot
// four hexes up the board it is the same distance short of the unit it comes down
// on. Either way the dart's tip reaches into the target's marker.
const ARROW_STANDOFF = hexWidth(HEX_SIZE) / 2;

type AttackTargetLayerProps = {
  // The hex the armed attacker stands on. Null while no attack is armed, which
  // is also when the list of targets is empty.
  fromKey: string | null;
  // Which attack is armed. A blow landed by hand is offered as the dart alone:
  // the target is the next hex over, and a line to it would say nothing the dart
  // does not. A volley is offered as the flight it would take, drawn while the
  // pointer rests on the unit it would come down on.
  kind: AttackKind;
  targets: AttackTarget[];
  hoveredUnitId: string | null;
  onHover: (unitId: string | null) => void;
  onPick: (unitId: string) => void;
};

// Who the armed attack may hit, drawn over the unit markers: an arrow from the
// attacker to each of them. Nothing is drawn while no attack is armed — the
// layer is handed an empty list then, the way the move targets are.
function AttackTargetLayer({
  fromKey,
  kind,
  targets,
  hoveredUnitId,
  onHover,
  onPick,
}: AttackTargetLayerProps) {
  const from = fromKey === null ? null : cellOf(fromKey);
  if (from === null) {
    return null;
  }

  return (
    <>
      {targets.map((target) => (
        <AttackArrow
          from={from}
          hovered={target.unitId === hoveredUnitId}
          key={target.unitId}
          lobbed={kind === "canopy"}
          onHover={onHover}
          onPick={onPick}
          target={target}
        />
      ))}
    </>
  );
}

function AttackArrow({
  from,
  hovered,
  lobbed,
  onHover,
  onPick,
  target,
}: {
  from: { x: number; y: number };
  hovered: boolean;
  lobbed: boolean;
  onHover: (unitId: string | null) => void;
  onPick: (unitId: string) => void;
  target: AttackTarget;
}) {
  const cell = cellOf(target.key);
  if (cell === null) {
    return null;
  }

  // The dart stands one standoff short of the target, along the way the blow
  // travels: its tip reaches into the target's marker and, for a blow landed by
  // hand, its tail rests on the attacker's. So the arrow says who is hitting whom
  // without a line between them.
  const radians = (Math.PI / 180) * target.direction;
  const dartX = cell.x - ARROW_STANDOFF * Math.sin(radians);
  const dartY = cell.y + ARROW_STANDOFF * Math.cos(radians);

  // The flight a volley would take, drawn only under the pointer: a shot four
  // hexes up the board needs the whole line said out loud, and every target
  // saying it at once would bury the board in arcs.
  const flight = lobbed && hovered ? shotArc(from, cell) : null;

  // Handlers on the group, so the hex and the arrow are one target between them:
  // a pointer crossing from one onto the other must not read as leaving. The
  // click is stopped here, or the canvas underneath would take the hex it landed
  // on as a plain selection and the attack would be called off.
  return (
    <g
      className={hovered ? `${styles.target} ${styles.hovered}` : styles.target}
      onClick={(event) => {
        event.stopPropagation();
        onPick(target.unitId);
      }}
      onPointerEnter={() => onHover(target.unitId)}
      onPointerLeave={() => onHover(null)}
    >
      {/* Carries the cell key, so the hex readout still answers for the hex this
          shape has taken the pointer away from. */}
      <polygon
        className={styles.hit}
        data-cell-key={target.key}
        points={HIT_POINTS}
        transform={`translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`}
      />
      {/* The line the arrow would fly, from the shooter's hex. Dashes running the
          way the shot goes, so the feedback says which end is the shooter — and
          the same curve the arrow is carried along once the shot is committed. */}
      {flight === null ? null : (
        <path
          className={styles.flight}
          d={flight.path}
          transform={`translate(${from.x.toFixed(2)} ${from.y.toFixed(2)})`}
        />
      )}
      {/* The ring that lights the target hex up is not drawn here. It is the hex
          outline itself, in the attack colour — see `attackKey` in
          `HexGridLayer`. Anything drawn inside the hex would land on the marker
          standing on it and cover the bars flanking that marker. */}
      <g transform={`translate(${dartX.toFixed(2)} ${dartY.toFixed(2)}) rotate(${target.direction})`}>
        <polygon className={styles.arrow} points={ARROW_POINTS} />
      </g>
    </g>
  );
}

export { AttackTargetLayer };
