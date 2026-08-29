import { TERRAIN_LABELS } from "@hw/ostrov-island-system";
import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_CATALOG, canAfford } from "../../../core/exports";
import { BUILDING_ICONS, TERRAIN_COLORS } from "../palette";
import { useStore } from "../../store/store";
import { ResourceChips } from "./resource-chips";
import type { FC } from "react";
import type { TBuildingDef } from "../../../core/exports";
import type { TPickBuildingAction } from "../../domain/registry";

type TCardDockRegistrySlice = {
  pickBuildingAction: TPickBuildingAction;
};

type TCardDockProps = {
  registry: TCardDockRegistrySlice;
};

type TCardProps = {
  def: TBuildingDef;
  picked: boolean;
  affordable: boolean;
  /** Something other than money blocks every tile: unique built, prerequisite missing. */
  locked: string | null;
  onPick: () => void;
};

const Card: FC<TCardProps> = ({ def, picked, affordable, locked, onPick }) => {
  const disabled = locked !== null;
  const className = ["card", picked ? "card--picked" : "", disabled ? "card--locked" : "", !affordable ? "card--poor" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} type="button" onClick={onPick} disabled={disabled} data-tip={locked ?? def.description}>
      <span className="card__head">
        <span className="card__icon">{BUILDING_ICONS[def.id]}</span>
        <span className="card__label">{def.label}</span>
      </span>
      <span className="card__terrains">
        {def.placement.terrains.map((terrain) => (
          <span
            key={terrain}
            className="card__terrain"
            style={{ background: TERRAIN_COLORS[terrain] }}
            title={TERRAIN_LABELS[terrain]}
          />
        ))}
        {def.placement.coastal ? <span className="card__flag">{"берег"}</span> : null}
        <span className="card__turns">{def.buildTurns > 0 ? `${def.buildTurns} х.` : "сразу"}</span>
      </span>
      <span className="card__row">
        <ResourceChips amounts={def.cost} />
      </span>
      <span className="card__row card__row--gain">
        <ResourceChips amounts={def.produces} signed />
        {def.science > 0 ? <span className="chip">{`🔬 +${def.science}`}</span> : null}
        {def.housing > 0 ? <span className="chip">{`👥 ${def.housing}`}</span> : null}
      </span>
    </button>
  );
};

/** Row of building cards along the bottom of the board. Pick one, then click a green hex. */
const CardDock: FC<TCardDockProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const settlement = store.gameState.settlement.value;
  const pickedKind = store.gameState.pickedKind.value;
  const ending = store.gameState.turnMessage.value !== null;

  const lockedReason = (def: TBuildingDef) => {
    if (def.unique && settlement.has(def.id)) {
      return "Уже построена";
    }

    if (!def.unique && !settlement.canEndTurn) {
      return "Сначала поставь Ратушу";
    }

    if (def.requires && !settlement.buildings.some((building) => building.kind === def.requires && building.isActive)) {
      const required = BUILDING_CATALOG.find((entry) => entry.id === def.requires);

      return `Сначала: ${required?.label ?? def.requires}`;
    }

    if (ending) {
      return "Ход завершается";
    }

    return null;
  };

  return (
    <div className={`dock${!settlement.canEndTurn ? " dock--first" : ""}`}>
      {BUILDING_CATALOG.map((def) => (
        <Card
          key={def.id}
          def={def}
          picked={pickedKind === def.id}
          affordable={canAfford(settlement.resources, def.cost)}
          locked={lockedReason(def)}
          onPick={() => registry.pickBuildingAction(def.id)}
        />
      ))}
    </div>
  );
};

export { CardDock };
