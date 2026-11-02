import type { FC } from "react";
import { api } from "../../domain/api";
import type { TMap, TPickView } from "../../domain/types";
import { teamOf } from "../labels";

type TMapGridProps = {
  pick: TPickView;
  maps: TMap[];
  selectable: boolean;
  selectedMap: string | null;
  onSelect: (mapId: string) => void;
};

const MapGrid: FC<TMapGridProps> = ({ pick, maps, selectable, selectedMap, onSelect }) => {
  return (
    <div className="map-grid">
      {maps.map((map) => {
        const action = pick.actions.find((candidate) => candidate.map === map.id);
        const isDecider = pick.decider === map.id;
        const playIndex = pick.playOrder.indexOf(map.id);
        const available = !action && !isDecider;
        const clickable = selectable && available;

        let state = "available";
        let badge: string | null = null;
        if (action?.kind === "ban") {
          state = "banned";
          badge = `Бан · ${teamOf(pick, action.side).name}`;
        } else if (action?.kind === "pick") {
          state = "picked";
          badge = `Пик · ${teamOf(pick, action.side).name}`;
        } else if (isDecider) {
          state = "decider";
          badge = pick.format === "bo3" ? "Решающая" : "Играем здесь";
        }

        const className = ["map-card", `map-${state}`, clickable ? "map-clickable" : "", selectedMap === map.id ? "map-selected" : ""].join(" ");
        return (
          <button
            key={map.id}
            type="button"
            className={className}
            disabled={!clickable}
            onClick={() => onSelect(map.id)}
            style={{ backgroundImage: `url(${api.mapArtUrl(map.id)})` }}
          >
            <span className="map-shade" />
            {badge && <span className="map-badge">{badge}</span>}
            {pick.format === "bo3" && playIndex >= 0 && <span className="map-order">Карта {playIndex + 1}</span>}
            <span className="map-name">{map.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export { MapGrid };
