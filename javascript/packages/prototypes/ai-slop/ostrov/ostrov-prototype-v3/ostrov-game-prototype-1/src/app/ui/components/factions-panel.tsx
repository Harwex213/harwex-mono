import { buildingsOf, factionLabel, unitsOf } from "../../../core/exports";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TFactionKind } from "../../../core/exports";

const KIND_LABELS: Record<TFactionKind, string> = {
  players: "Союз игроков (вы)",
  natives: "Туземцы",
  hitech: "Сверхразвитая цитадель",
  rival: "Королевство",
};

/** Every faction of the world, with what the players know about it. */
const FactionsPanel: FC = () => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  let unknownIndex = 0;

  return (
    <div className="stack">
      <div className="muted">Фракции владеют всеми зданиями и юнитами. Имя чужой фракции открывается, когда ваш юнит подходит к её землям.</div>

      {game.factions.map((faction) => {
        if (!faction.discovered) {
          unknownIndex += 1;
        }

        const label = factionLabel(faction, unknownIndex);
        const home = faction.homeIslandId === null ? null : game.islands.find((island) => island.id === faction.homeIslandId) ?? null;
        const units = unitsOf(game, faction.id);
        const buildings = buildingsOf(game, faction.id);

        return (
          <div key={faction.id} className={`card card--faction ${faction.alive ? "" : "card--dead"}`}>
            <div className="card__title">
              <span className="swatch" style={{ background: faction.color }} />
              {label}
              {faction.alive ? "" : " · пала"}
            </div>
            <div className="muted">{faction.discovered ? KIND_LABELS[faction.kind] : "Неизвестно"}</div>
            {faction.discovered ? (
              <>
                <div className="muted">«{faction.motto}»</div>
                <div className="row">
                  <span>{home === null ? "Без дома" : `Дом: ${home.name}`}</span>
                  <span className="muted">
                    {buildings.length} зданий · {units.length} юнитов
                  </span>
                </div>
              </>
            ) : (
              <div className="muted">О ней известно только то, что она ходит.</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export { FactionsPanel };
