import { LEGEND_ORDER, TERRAIN_STYLES } from "../render/palette";

const TerrainLegend = () => (
  <section className="panel">
    <h2 className="panel__title">{"Legend"}</h2>
    <ul className="legend">
      {LEGEND_ORDER.map((kind) => (
        <li key={kind} className="legend__item">
          <span className="swatch" style={{ background: TERRAIN_STYLES[kind].fill }} />
          <span>{TERRAIN_STYLES[kind].label}</span>
        </li>
      ))}
    </ul>
  </section>
);

export { TerrainLegend };
