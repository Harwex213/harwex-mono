import type { AttackTarget } from "../state/attack-strategies";
import { cellOf } from "../state/grid-state";
import { HEX_INSET, HEX_SIZE, hexPoints } from "./hex-layout";
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

type AttackTargetLayerProps = {
  // The hex the armed attacker stands on. Null while no attack is armed, which
  // is also when the list of targets is empty.
  fromKey: string | null;
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
          fromX={from.x}
          fromY={from.y}
          hovered={target.unitId === hoveredUnitId}
          key={target.unitId}
          onHover={onHover}
          onPick={onPick}
          target={target}
        />
      ))}
    </>
  );
}

function AttackArrow({
  fromX,
  fromY,
  hovered,
  onHover,
  onPick,
  target,
}: {
  fromX: number;
  fromY: number;
  hovered: boolean;
  onHover: (unitId: string | null) => void;
  onPick: (unitId: string) => void;
  target: AttackTarget;
}) {
  const cell = cellOf(target.key);
  if (cell === null) {
    return null;
  }

  // The dart sits halfway between the two hexes, which is the seam the blow
  // crosses: its tip reaches into the target's marker and its tail rests on the
  // attacker's, so the arrow says who is hitting whom without a line between
  // them.
  const midX = (fromX + cell.x) / 2;
  const midY = (fromY + cell.y) / 2;

  // Handlers on the group, so the hex and the arrow are one target between
  // them: a pointer crossing from one onto the other must not read as leaving.
  // The click is stopped here, or the canvas underneath would take the hex it
  // landed on as a plain selection and the attack would be called off.
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
      {/* The ring that lights the target hex up is not drawn here. It is the hex
          outline itself, in the attack colour — see `attackKey` in
          `HexGridLayer`. Anything drawn inside the hex would land on the marker
          standing on it and cover the bars flanking that marker. */}
      <g transform={`translate(${midX.toFixed(2)} ${midY.toFixed(2)}) rotate(${target.direction})`}>
        <polygon className={styles.arrow} points={ARROW_POINTS} />
      </g>
    </g>
  );
}

export { AttackTargetLayer };
