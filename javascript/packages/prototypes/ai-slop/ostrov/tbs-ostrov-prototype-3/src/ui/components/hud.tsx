import { useSignals } from "@preact/signals-react/runtime";
import { RESOURCE_ICONS, RESOURCE_LABELS, RESOURCE_LIST, incomeOf } from "../../domain/world/resources";
import { linkedIdsOf } from "../../domain/world/world";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TNewWorldAction } from "../../domain/registry";

type THudRegistrySlice = {
  newWorldAction: TNewWorldAction;
};

type THudProps = {
  registry: THudRegistrySlice;
};

/** Top bar: turn, treasury with income per turn, and a new-sky button. */
const Hud: FC<THudProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const { world, turn, resources, seedText } = store.gameState;
  const player = world.value.islands.find((entry) => entry.owner === "player")!;
  const linkCount = linkedIdsOf(world.value, player.id).length;
  const income = incomeOf(player.island.counts, linkCount);

  return (
    <header className="hud">
      <div className="hud__title">
        <span className="hud__name">{player.island.name}</span>
        <span className="hud__turn">{`Ход ${turn.value}`}</span>
      </div>

      <ul className="hud__resources">
        {RESOURCE_LIST.map((resource) => (
          <li key={resource} className="hud__resource" title={RESOURCE_LABELS[resource]}>
            <span className="hud__resource-icon">{RESOURCE_ICONS[resource]}</span>
            <span className="hud__resource-value">{resources.value[resource]}</span>
            <span className="hud__resource-income">{`+${income[resource]}`}</span>
          </li>
        ))}
      </ul>

      <div className="hud__actions">
        <span className="hud__seed">{seedText.value}</span>
        <button type="button" className="hud__button" onClick={() => registry.newWorldAction("")}>
          {"Новое небо"}
        </button>
      </div>
    </header>
  );
};

export { Hud };
