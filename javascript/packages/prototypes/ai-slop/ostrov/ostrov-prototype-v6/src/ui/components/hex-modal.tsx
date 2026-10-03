import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../core/biomes";
import {
  averageToxicityOn,
  averageYieldOn,
  bestBuildingForBiome,
  buildingsForBiome,
  getBuilding,
} from "../../core/buildings";
import { hexCornerPoints } from "../../core/hex";
import { ICONS } from "../../core/icons";
import { getResource } from "../../core/resources";
import { hexDie } from "../../core/dice";
import { isStrongholdHex, POWER_PER_TURN, STRONGHOLD_LABEL } from "../../core/stronghold";
import { useStore } from "../../store/store";
import { DieAverage, DieFaces } from "./die-faces";
import { StructureHpLine } from "./hex-hp-bar";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TArmBuildingAction, TCloseHexModalAction } from "../../domain/registry";

/** Radius of the biome emblem drawn in the modal header. */
const EMBLEM_SIZE = 46;
const EMBLEM_POINTS = hexCornerPoints(EMBLEM_SIZE);

type THexModalRegistrySlice = {
  armBuildingAction: TArmBuildingAction;
  closeHexModalAction: TCloseHexModalAction;
};

type THexModalProps = {
  registry: THexModalRegistrySlice;
};

/**
 * The modal the spec opens on the right when a hex is clicked: what the biome
 * is, the die of what stands on it, and which building suits it best. The hint is derived from the yield
 * tables, so it cannot drift away from them.
 */
const HexModal: FC<THexModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const hex = store.derived.selectedHex.value;
  const isReadonly = store.derived.isReadonly.value;
  const player = store.derived.viewedPlayer.value;

  if (!hex) {
    return null;
  }

  const biome = getBiome(hex.biome);
  const allowed = buildingsForBiome(hex.biome);
  const best = bestBuildingForBiome(hex.biome);
  const building = hex.building ? getBuilding(hex.building) : null;
  const isStronghold = isStrongholdHex(player, hex.id);
  const standing = isStronghold ? STRONGHOLD_LABEL : building?.label ?? null;
  const die = hexDie(player, hex);
  const hint = best ? `Лучше всего здесь встанет: ${best.label}` : "Строить здесь нечего";
  const subtitle = isStronghold ? "Твердыня занимает гекс: строить здесь нельзя" : hint;

  return (
    <aside className="panel hex-modal">
      <button type="button" className="hex-modal__close" onClick={registry.closeHexModalAction}>
        <Icon src={ICONS.close} label="Закрыть" size="m" />
      </button>

      <svg className="hex-modal__emblem" viewBox="-50 -50 100 100" role="presentation">
        <polygon points={EMBLEM_POINTS} fill={biome.color} stroke={biome.edgeColor} strokeWidth={4} />
      </svg>

      <h2 className="hex-modal__title">
        {biome.label}
      </h2>

      <p className="hex-modal__description">
        {biome.description}
      </p>

      {standing ? (
        <p className="hex-modal__standing">
          {`Здесь стоит: ${standing}`}
        </p>
      ) : null}

      <StructureHpLine player={player} hex={hex} className="hex-modal__standing" />

      {die ? (
        <div className="hex-modal__die">
          <DieFaces faces={die.faces} biomeFaceIndex={die.biomeFaceIndex} biomeLabel={biome.label} hex={hex} />

          <p className="hex-modal__die-row">
            {"В среднем за бросок: "}
            <DieAverage die={die} />
          </p>

          {isStronghold ? (
            <p className="hex-modal__die-row">
              <Icon src={ICONS.power} label="Власть" />
              {`+${POWER_PER_TURN} власть в конце каждой фазы налогов`}
            </p>
          ) : null}
        </div>
      ) : null}

      <h3 className="hex-modal__subtitle">
        {subtitle}
      </h3>

      <ul className="hex-modal__list">
        {allowed.map((building) => (
          <li className="hex-modal__option" key={building.id}>
            <button
              type="button"
              className="hex-modal__option-button"
              disabled={isReadonly || standing !== null}
              onClick={() => registry.armBuildingAction(building.id)}
            >
              <img className="hex-modal__option-art" src={building.art} alt={building.label} />

              <span className="hex-modal__option-name">
                {building.label}
              </span>

              <span className="hex-modal__option-numbers">
                <Icon src={getResource(building.yields).icon} label={getResource(building.yields).label} />
                {averageYieldOn(building, hex.biome).toFixed(1)}
                {" · "}
                <Icon src={ICONS.toxicity} label="Токсичность" />
                {averageToxicityOn(building, hex.biome).toFixed(1)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};

export { HexModal };
