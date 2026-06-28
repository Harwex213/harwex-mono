/**
 * View layer — the SVG hex grid (§10 rendering).
 *
 * Draws every board tile as a pointy-top hexagon coloured by terrain, shaded by
 * elevation, hatched when impassable and outlined when it blocks line of fire
 * (§2.3). Unit tokens are overlaid on top. Move targets for the selected unit
 * are ringed (§7.2) and attackable enemies get a target reticle (§7.1); clicking
 * one performs that action, clicking another unit selects it, and clicking empty
 * ground clears the selection.
 */

import { observer } from 'mobx-react-lite';
import type { Board, Hex } from '@/model/board';
import type { UnitState } from '@/model/unit-state';
import type { Axial } from '@/model/types';
import { TERRAIN } from '@/model/terrain';
import { hexCenter, hexCornersPath, hexPixelSize, type Point } from '../hex-geometry';
import { UnitToken } from './UnitToken';
import styles from './HexGrid.module.css';

const HEX_SIZE = 36;

interface HexGridProps {
  board: Board;
  units: UnitState[];
  selectedUnitId: string | null;
  /** Keys (`coordKey`) of hexes the selected unit may step into (§7.2). */
  moveTargetKeys: Set<string>;
  /** Ids of enemies the selected unit may attack right now (§7.1). */
  attackableIds: Set<string>;
  onSelectUnit: (id: string | null) => void;
  onMoveTo: (coord: Axial) => void;
  onAttack: (defenderId: string) => void;
  /** Hovering an attackable enemy raises a damage preview at the cursor (item 13). */
  onHoverTarget: (defenderId: string | null, clientX: number, clientY: number) => void;
}

/** One rendered tile: terrain fill + elevation shade + impassable/LoS markers. */
const HexTile = observer(({ hex, center, hasUnit }: { hex: Hex; center: Point; hasUnit: boolean }) => {
  const info = TERRAIN[hex.terrain];
  const points = hexCornersPath(center, HEX_SIZE);
  const impassable = !hex.isPassable;
  const muddy = hex.state === 'mud';
  const frozen = hex.state === 'frozen';

  return (
    <g>
      <polygon
        points={points}
        fill={info.color}
        stroke={hex.blocksLineOfFire ? '#b58cff' : '#0d0b09'}
        strokeWidth={hex.blocksLineOfFire ? 2 : 1}
        strokeDasharray={hex.blocksLineOfFire ? '4 3' : undefined}
      />

      {/* Elevation: lighten higher ground. */}
      {hex.elevation > 0 && (
        <polygon points={points} fill="#ffffff" opacity={0.07 * hex.elevation} pointerEvents="none" />
      )}

      {/* Impassable tiles get a hatch overlay. */}
      {impassable && <polygon points={points} fill="url(#hatch)" pointerEvents="none" />}

      {/* Mud darkens; frozen water gets a pale sheen. */}
      {muddy && <polygon points={points} fill="#1c1206" opacity={0.4} pointerEvents="none" />}
      {frozen && <polygon points={points} fill="#cfe6ff" opacity={0.18} pointerEvents="none" />}

      {/* Faint terrain glyph when no token occupies the tile. */}
      {!hasUnit && (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={HEX_SIZE * 0.5}
          fill="#ffffff"
          opacity={0.22}
          pointerEvents="none"
        >
          {info.glyph}
        </text>
      )}
    </g>
  );
});

export const HexGrid = observer((props: HexGridProps) => {
  const { board, units, selectedUnitId, moveTargetKeys, attackableIds } = props;
  const { onSelectUnit, onMoveTo, onAttack, onHoverTarget } = props;
  // Map each hex to a pixel centre, then derive the padded SVG viewBox.
  const placed = board.hexes.map((hex) => ({ hex, center: hexCenter(hex.coord, HEX_SIZE) }));
  const { width: hexW, height: hexH } = hexPixelSize(HEX_SIZE);
  const xs = placed.map((p) => p.center.x);
  const ys = placed.map((p) => p.center.y);
  const padX = hexW / 2 + 4;
  const padY = hexH / 2 + 14; // extra room for crowns / bars
  const minX = Math.min(...xs) - padX;
  const minY = Math.min(...ys) - padY;
  const viewW = Math.max(...xs) - Math.min(...xs) + padX * 2;
  const viewH = Math.max(...ys) - Math.min(...ys) + padY * 2;

  const unitByKey = new Map(units.map((unit) => [`${unit.hex.q},${unit.hex.r}`, unit]));

  return (
    <svg
      className={styles.grid}
      viewBox={`${minX} ${minY} ${viewW} ${viewH}`}
      role="img"
      aria-label="Battlefield"
      onClick={(event) => {
        // A click that reaches the svg background (not a token) clears selection.
        if (event.target === event.currentTarget) onSelectUnit(null);
      }}
    >
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#0d0b09" strokeWidth="2" opacity="0.5" />
        </pattern>
      </defs>

      {placed.map(({ hex, center }) => (
        <HexTile key={hex.key} hex={hex} center={center} hasUnit={unitByKey.has(hex.key)} />
      ))}

      {/* Move-target rings on the selected unit's reachable front hexes (§7.2). */}
      {placed.map(({ hex, center }) =>
        moveTargetKeys.has(hex.key) ? (
          <polygon
            key={`move-${hex.key}`}
            points={hexCornersPath(center, HEX_SIZE - 3)}
            fill="#f2c14e"
            fillOpacity={0.12}
            stroke="#f2c14e"
            strokeWidth={2}
            strokeDasharray="5 4"
            style={{ cursor: 'pointer' }}
            onClick={() => onMoveTo(hex.coord)}
          />
        ) : null,
      )}

      {placed.map(({ hex, center }) => {
        const unit = unitByKey.get(hex.key);
        if (!unit) return null;
        const attackable = attackableIds.has(unit.id);
        return (
          <UnitToken
            key={unit.id}
            unit={unit}
            center={center}
            size={HEX_SIZE}
            selected={unit.id === selectedUnitId}
            attackable={attackable}
            onSelect={attackable ? onAttack : onSelectUnit}
            onHover={
              attackable
                ? (clientX, clientY) => onHoverTarget(unit.id, clientX, clientY)
                : () => onHoverTarget(null, 0, 0)
            }
          />
        );
      })}
    </svg>
  );
});
