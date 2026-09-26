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
import { getResource } from "../../core/resources";
import { useStore } from "../../store/store";
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
 * is, and which building suits it best. The hint is derived from the yield
 * tables, so it cannot drift away from them.
 */
const HexModal: FC<THexModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const hex = store.derived.selectedHex.value;
  const isReadonly = store.derived.isReadonly.value;

  if (!hex) {
    return null;
  }

  const biome = getBiome(hex.biome);
  const allowed = buildingsForBiome(hex.biome);
  const best = bestBuildingForBiome(hex.biome);
  const standing = hex.building ? getBuilding(hex.building) : null;

  return (
    <aside className="panel hex-modal">
      <button type="button" className="hex-modal__close" onClick={registry.closeHexModalAction}>
        {"✕"}
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
          {`Здесь стоит: ${standing.label}`}
        </p>
      ) : null}

      <h3 className="hex-modal__subtitle">
        {best ? `Лучше всего здесь встанет: ${best.label}` : "Строить здесь нечего"}
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
                {`${getResource(building.yields).emoji} ${averageYieldOn(building, hex.biome).toFixed(1)}`}
                {" · "}
                {`☣️ ${averageToxicityOn(building, hex.biome).toFixed(1)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};

export { HexModal };
