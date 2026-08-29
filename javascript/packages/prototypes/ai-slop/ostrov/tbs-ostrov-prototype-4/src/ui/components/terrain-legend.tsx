import { TERRAIN, TERRAIN_KINDS } from "../../domain/world/terrain";
import { TERRAIN_STYLE } from "../render/palette";
import type { FC } from "react";

const TerrainLegend: FC = () => {
  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Местность"}
      </h2>

      <ul className="legend">
        {TERRAIN_KINDS.map((kind) => {
          const traits = TERRAIN[kind];

          return (
            <li key={kind} className="legend__item">
              <span className="legend__swatch" style={{ background: TERRAIN_STYLE[kind].fill }} />
              <span className="legend__label">
                {traits.label}
              </span>
              <span className="legend__meta">
                {traits.moveCost === null ? "—" : `ход ${traits.moveCost} · защита ×${traits.defence.toFixed(2)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export { TerrainLegend };
