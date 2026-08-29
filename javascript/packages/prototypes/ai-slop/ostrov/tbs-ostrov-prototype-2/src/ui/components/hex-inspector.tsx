import { useSignals } from "@preact/signals-react/runtime";
import { readCell } from "../../domain/generator/types";
import { offsetToAxial } from "../../domain/hex/coords";
import { useStore } from "../../store/store";
import { TERRAIN_STYLES } from "../render/palette";

const HexInspector = () => {
  useSignals();
  const store = useStore();
  const map = store.generatorState.map.value;
  const hoveredIndex = store.viewState.hoveredIndex.value;
  const cell = map ? readCell(map, hoveredIndex) : null;

  if (!map) {
    return null;
  }

  if (!cell) {
    return (
      <section className="panel">
        <h2 className="panel__title">{"Hex"}</h2>
        <p className="panel__empty">{"Point at the map to inspect a hex. Click an island to isolate it."}</p>
      </section>
    );
  }

  const axial = offsetToAxial(cell.col, cell.row);
  const island = cell.islandId === -1 ? null : map.islands[cell.islandId];

  return (
    <section className="panel">
      <h2 className="panel__title">{"Hex"}</h2>
      <dl className="stats">
        <div className="stats__row">
          <dt>{"Offset"}</dt>
          <dd>{`${cell.col}, ${cell.row}`}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Axial"}</dt>
          <dd>{`${axial.q}, ${axial.r}`}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Terrain"}</dt>
          <dd>
            <span className="swatch" style={{ background: TERRAIN_STYLES[cell.terrain].fill }} />
            {TERRAIN_STYLES[cell.terrain].label}
          </dd>
        </div>
        <div className="stats__row">
          <dt>{"Height"}</dt>
          <dd>{cell.height.toFixed(3)}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Elevation"}</dt>
          <dd>{cell.elevation.toFixed(3)}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Moisture"}</dt>
          <dd>{cell.moisture.toFixed(3)}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Coast"}</dt>
          <dd>{cell.isLand ? `${cell.coastDistance} from water` : "water"}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Island"}</dt>
          <dd>{island ? `${island.name} (${island.size} hex)` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
};

export { HexInspector };
