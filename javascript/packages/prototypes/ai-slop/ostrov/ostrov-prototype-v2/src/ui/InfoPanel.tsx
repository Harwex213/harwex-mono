import { useSignals } from "@preact/signals-react/runtime";
import type { Tile } from "../map/island";
import { OWNER_PLAYER } from "../map/island";
import { TERRAIN_STYLES } from "../map/terrain";
import { camera, hoveredTile, island, reseed, seed, selectedTile } from "../state/signals";

function TileRows({ tile }: { tile: Tile }): React.JSX.Element {
  const style = TERRAIN_STYLES[tile.terrain];
  return (
    <>
      <div className="row">
        <span>Координаты</span>
        <span className="mono">
          q {tile.q}, r {tile.r}
        </span>
      </div>
      <div className="row">
        <span>Территория</span>
        <span className="swatch-row">
          <i className="swatch" style={{ background: style.top }} />
          {style.label}
        </span>
      </div>
      <div className="row">
        <span>Владелец</span>
        <span className={tile.owner === OWNER_PLAYER ? "owned" : "wild"}>
          {tile.owner === OWNER_PLAYER ? "Королевство" : "Ничья земля"}
        </span>
      </div>
    </>
  );
}

function InfoPanel(): React.JSX.Element {
  useSignals();
  const selection = selectedTile.value;
  const hover = hoveredTile.value;
  const owned = island.value.tiles.filter((tile) => tile.owner === OWNER_PLAYER).length;

  return (
    <aside className="panel">
      <header className="panel-head">
        <h1>Остров</h1>
        <span className="mono muted">×{camera.value.scale.toFixed(2)}</span>
      </header>

      <section className="block">
        <h2>Выбранный гекс</h2>
        {selection ? <TileRows tile={selection} /> : <p className="muted">Кликните по гексу.</p>}
      </section>

      <section className="block">
        <h2>Под курсором</h2>
        {hover ? (
          <p className="mono">
            q {hover.q}, r {hover.r} — {TERRAIN_STYLES[hover.terrain].label}
          </p>
        ) : (
          <p className="muted">—</p>
        )}
      </section>

      <section className="block">
        <div className="row">
          <span>Гексов</span>
          <span className="mono">{island.value.tiles.length}</span>
        </div>
        <div className="row">
          <span>Во владении</span>
          <span className="mono">{owned}</span>
        </div>
        <div className="row">
          <span>Сид</span>
          <span className="mono">{seed.value}</span>
        </div>
      </section>

      <button type="button" className="wide" onClick={() => reseed((Math.random() * 0xffffffff) >>> 0)}>
        Новый остров
      </button>

      <p className="hint">Тяните мышью — панорама. Колесо или пинч — зум к курсору.</p>
    </aside>
  );
}

export { InfoPanel };
