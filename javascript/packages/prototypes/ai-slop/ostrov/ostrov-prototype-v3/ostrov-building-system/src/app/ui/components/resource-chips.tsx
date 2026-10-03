import { RESOURCE_LABELS, RESOURCE_LIST, RESOURCE_PURPOSES } from "../../../core/exports";
import { RESOURCE_COLORS, RESOURCE_ICONS } from "../palette";
import type { FC, ReactNode } from "react";
import type { TResources } from "../../../core/exports";

type TChipProps = {
  icon: ReactNode;
  color: string;
  /** Tooltip text. */
  tip: string;
  value: string | number;
  /** A second number after the value, coloured by sign. */
  delta?: number;
};

/** One `icon value` pair with a hover tooltip. */
const Chip: FC<TChipProps> = ({ icon, color, tip, value, delta }) => (
  <span className="chip" data-tip={tip} style={{ color }}>
    <span className="chip__icon">{icon}</span>
    <span className="chip__value">{value}</span>
    {delta !== undefined ? (
      <span className={`chip__delta chip__delta--${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
        {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : delta}
      </span>
    ) : null}
  </span>
);

type TResourceChipsProps = {
  amounts: TResources;
  /** Show every kind, zero included. Otherwise zeros are skipped. */
  full?: boolean;
  /** Show `+` in front of a positive number. */
  signed?: boolean;
  /** Per-turn change, shown after each value. */
  deltas?: TResources;
};

/** One chip per resource kind. Used everywhere resource numbers show up. */
const ResourceChips: FC<TResourceChipsProps> = ({ amounts, full = false, signed = false, deltas }) => {
  const kinds = RESOURCE_LIST.filter((kind) => full || amounts[kind] !== 0);

  if (kinds.length === 0) {
    return <span className="chips chips--empty">{"—"}</span>;
  }

  return (
    <span className="chips">
      {kinds.map((kind) => {
        const value = amounts[kind];

        return (
          <Chip
            key={kind}
            icon={RESOURCE_ICONS[kind]}
            color={RESOURCE_COLORS[kind]}
            tip={`${RESOURCE_LABELS[kind]} — ${RESOURCE_PURPOSES[kind]}`}
            value={signed && value > 0 ? `+${value}` : value}
            delta={deltas?.[kind]}
          />
        );
      })}
    </span>
  );
};

export { Chip, ResourceChips };
