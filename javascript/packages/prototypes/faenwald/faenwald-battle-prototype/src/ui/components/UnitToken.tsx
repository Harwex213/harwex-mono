/**
 * View layer — a unit token drawn on the hex grid.
 *
 * An SVG group positioned by the parent {@link HexGrid} at a hex centre. Shows
 * the unit's side colour, a facing arrow (§2.2), its category icon, a ruler
 * crown (§11.3) and live HP/morale bars (§3.1) — the at-a-glance state the GDD
 * wants visible without opening the card.
 */

import { observer } from 'mobx-react-lite';
import type { UnitState } from '@/model/unit-state';
import { facingVector, type Point } from '../hex-geometry';

interface UnitTokenProps {
  unit: UnitState;
  center: Point;
  size: number;
  selected: boolean;
  /** Whether this enemy can be attacked by the selected unit right now (§7.1). */
  attackable?: boolean;
  /** Click handler — selects the unit, or attacks it when {@link attackable}. */
  onSelect: (id: string) => void;
  /** Pointer enter/leave, used to raise the damage preview over an attackable target. */
  onHover?: (clientX: number, clientY: number) => void;
}

const SIDE_FILL: Record<'blue' | 'red', string> = {
  blue: '#3f74c4',
  red: '#cf5048',
};

export const UnitToken = observer(
  ({ unit, center, size, selected, attackable = false, onSelect, onHover }: UnitTokenProps) => {
    const radius = size * 0.58;
  const dir = facingVector(unit.facing);
  const perp: Point = { x: -dir.y, y: dir.x };

  // Facing arrow: a small triangle just outside the token edge.
  const tip: Point = { x: center.x + dir.x * (radius + 9), y: center.y + dir.y * (radius + 9) };
  const baseCenter: Point = { x: center.x + dir.x * (radius + 1), y: center.y + dir.y * (radius + 1) };
  const arrow = [
    `${tip.x},${tip.y}`,
    `${baseCenter.x + perp.x * 5},${baseCenter.y + perp.y * 5}`,
    `${baseCenter.x - perp.x * 5},${baseCenter.y - perp.y * 5}`,
  ].join(' ');

  // HP / morale bars sit beneath the token.
  const barWidth = radius * 1.9;
  const barHeight = Math.max(3, size * 0.11);
  const barX = center.x - barWidth / 2;
  const hpY = center.y + radius + 4;
  const moraleY = hpY + barHeight + 2;

  const dimmed = !unit.isAlive || unit.isRouted;
  const ringColor = attackable ? '#cf5048' : selected ? '#f2c14e' : '#15110d';

  return (
    <g
      onClick={() => onSelect(unit.id)}
      onMouseEnter={(event) => onHover?.(event.clientX, event.clientY)}
      onMouseMove={(event) => onHover?.(event.clientX, event.clientY)}
      onMouseLeave={() => onHover?.(0, 0)}
      style={{ cursor: 'pointer', opacity: dimmed ? 0.4 : 1 }}
      role="button"
      aria-label={`${unit.name} (${unit.side})`}
    >
      {/* Attack reticle on an enemy the selected unit can strike (§7.1). */}
      {attackable && (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius + 4}
          fill="none"
          stroke="#cf5048"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      )}

      <polygon points={arrow} fill={selected ? '#f2c14e' : '#e8e0d0'} />

      <circle
        cx={center.x}
        cy={center.y}
        r={radius}
        fill={SIDE_FILL[unit.side]}
        stroke={ringColor}
        strokeWidth={selected || attackable ? 3 : 1.5}
      />

      <text
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={radius * 1.05}
        style={{ pointerEvents: 'none' }}
      >
        {unit.icon}
      </text>

      {unit.isRuler && (
        <text
          x={center.x}
          y={center.y - radius - 3}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.5}
          style={{ pointerEvents: 'none' }}
        >
          👑
        </text>
      )}

      {/* HP bar (green). */}
      <rect x={barX} y={hpY} width={barWidth} height={barHeight} rx={1.5} fill="#15110d" />
      <rect x={barX} y={hpY} width={barWidth * unit.hpRatio} height={barHeight} rx={1.5} fill="#6aa84f" />

      {/* Morale bar (gold). */}
      <rect x={barX} y={moraleY} width={barWidth} height={barHeight} rx={1.5} fill="#15110d" />
      <rect
        x={barX}
        y={moraleY}
        width={barWidth * unit.moraleRatio}
        height={barHeight}
        rx={1.5}
        fill="#d8a657"
      />
    </g>
  );
  },
);
