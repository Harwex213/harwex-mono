import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_DEFS } from "../game/config";
import * as hud from "../game/hud";
import { game } from "../game/instance";
import { costText } from "./format";

const STATE_NAMES: Record<string, string> = {
  locked: "Не наш",
  contested: "Идёт захват",
  owned: "Наш",
};

function SectorPanel(): React.JSX.Element {
  useSignals();
  const index = hud.selectedSector.value;
  const sector = index === null ? null : hud.sectors.value[index];
  const cost = hud.expansionCost.value;

  if (!sector) {
    return (
      <div className="panel side right">
        <div className="panel-head">
          <h2>Секторы</h2>
          <span className="muted">наших: {hud.ownedSectors.value}</span>
        </div>
        <p className="hint">Кликните по сектору на карте, чтобы посмотреть его и двинуть туда остров.</p>
        <Expansion />
      </div>
    );
  }

  const unique = BUILDING_DEFS.filter((def) => def.terrain?.includes(sector.terrain));
  // Reading the wallet here also ties this card to the resource signals, so the
  // blocker below — which asks the live world — is recomputed as they change.
  const affordable = hud.gold.value >= cost.gold && hud.wood.value >= cost.wood;
  const blocker = game.canExpand(sector.index);

  return (
    <div className="panel side right">
      <div className="panel-head">
        <h2>{sector.terrainName}</h2>
        <span className="muted">
          {sector.col + 1}:{sector.row + 1}
        </span>
      </div>
      <div className="rows">
        <div className="row">
          <span>Состояние</span>
          <span>{STATE_NAMES[sector.state]}</span>
        </div>
        {unique.length > 0 ? (
          <div className="row">
            <span>Открывает</span>
            <span>{unique.map((def) => def.name).join(", ")}</span>
          </div>
        ) : null}
        {sector.state === "contested" ? (
          <div className="row">
            <span>Захват</span>
            <span>{Math.round(sector.attach * 100)}%</span>
          </div>
        ) : null}
      </div>

      {sector.state !== "owned" ? (
        <button type="button" className="wide primary" disabled={blocker !== null} onClick={() => game.expand(sector.index)}>
          Двинуть остров · <span className={affordable ? "" : "cost-bad"}>{costText(cost)}</span>
        </button>
      ) : null}
      {blocker && sector.state !== "owned" ? <div className="card-blocker">{blocker}</div> : null}
      <Expansion />
    </div>
  );
}

function Expansion(): React.JSX.Element | null {
  useSignals();
  const current = hud.expansion.value;
  if (!current) {
    return null;
  }
  return (
    <div className="expansion">
      <h3>Остров в движении</h3>
      <div className="row">
        <span>Цель</span>
        <span>{current.name}</span>
      </div>
      <div className="row">
        <span>{current.guards > 0 ? "Стражи" : "Присоединение"}</span>
        <span>{current.guards > 0 ? current.guards : `${Math.round(current.attach * 100)}%`}</span>
      </div>
      <p className="hint">
        {current.guards > 0
          ? "Отправьте армию точкой сбора и перебейте стражей."
          : "Земля пристаёт к острову. Волна не будет ждать."}
      </p>
    </div>
  );
}

export { SectorPanel };
