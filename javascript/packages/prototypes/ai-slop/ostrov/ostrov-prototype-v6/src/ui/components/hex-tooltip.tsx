import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../core/biomes";
import { buildRefusal } from "../../core/build-check";
import {
  averageToxicityOn,
  averageYieldOn,
  canBuildOn,
  effectiveCost,
  facesOn,
  getBuilding,
} from "../../core/buildings";
import { ICONS } from "../../core/icons";
import { getResource } from "../../core/resources";
import { hexDie } from "../../core/dice";
import { canPlaceStronghold, isStrongholdHex, POWER_PER_TURN, STRONGHOLD_LABEL } from "../../core/stronghold";
import { facePayout, isDead, isFoodBlocked } from "../../core/tax";
import { findRoll } from "../../core/tax-plan";
import { useStore } from "../../store/store";
import { DieAverage, DieFaces } from "./die-faces";
import { StructureHpLine } from "./hex-hp-bar";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TPayoutEffects } from "../../core/tax";
import type { TTaxRoll } from "../../core/tax-plan";
import type { TBuilding, THex, TPlayer } from "../../core/types";

type TBuildPreviewProps = {
  hex: THex;
  building: TBuilding;
  player: TPlayer;
  stoneDiscount: number;
  anchor: { x: number; y: number };
};

/**
 * What the armed building would be on the hovered hex: its die on this biome,
 * what the hex's toxicity leaves of each face, the price, and why the click
 * would be refused. The canvas shows the building itself as a ghost on the hex.
 * The verdict comes from the same rules the build action runs.
 */
const BuildPreview: FC<TBuildPreviewProps> = ({ hex, building, player, stoneDiscount, anchor }) => {
  const biome = getBiome(hex.biome);
  const refusal = buildRefusal(player, hex, building, stoneDiscount);
  const fits = canBuildOn(building, hex.biome);
  const cost = effectiveCost(building, stoneDiscount);
  const pool = player.resources;
  const standing = isStrongholdHex(player, hex.id)
    ? STRONGHOLD_LABEL
    : hex.building
      ? getBuilding(hex.building).label
      : null;
  const biomeFace = building.biomeFaces[hex.biome];
  const faces = facesOn(building, hex.biome);

  return (
    <div
      className={`hex-tooltip hex-tooltip--build ${refusal ? "hex-tooltip--refused" : "hex-tooltip--allowed"}`}
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <div className="hex-tooltip__biome">
        {biome.label}
      </div>

      {standing ? (
        <div className="hex-tooltip__standing">
          {`здесь стоит: ${standing}`}
        </div>
      ) : null}

      {fits ? (
        <DieFaces
          faces={faces}
          biomeFaceIndex={biomeFace === undefined ? -1 : faces.length - 1}
          biomeLabel={biome.label}
          hex={hex}
        />
      ) : null}

      {fits ? (
        <div className="hex-tooltip__row">
          {"В среднем: "}
          <Icon src={getResource(building.yields).icon} label={getResource(building.yields).label} />
          {averageYieldOn(building, hex.biome).toFixed(1)}
          {" · "}
          <Icon src={ICONS.toxicity} label="Токсичность" />
          {averageToxicityOn(building, hex.biome).toFixed(1)}
        </div>
      ) : null}

      <div className="hex-tooltip__row">
        {"Цена: "}

        <span className={pool.stone >= cost.stone ? "" : "cost--short"}>
          <Icon src={ICONS.stone} label="Камень" />
          {cost.stone}
        </span>

        <span className={pool.wood >= cost.wood ? "" : "cost--short"}>
          <Icon src={ICONS.wood} label="Дерево" />
          {cost.wood}
        </span>

        <span className={pool.hammers >= cost.hammers ? "" : "cost--short"}>
          <Icon src={ICONS.hammers} label="Молотки" />
          {cost.hammers}
        </span>
      </div>

      {hex.toxicity > 0 ? (
        <div className="hex-tooltip__toxicity">
          {`Токсичность гекса: ${Math.round(hex.toxicity)}% — урожай меньше`}
        </div>
      ) : null}

      {refusal === null && isDead(hex) ? (
        <div className="hex-tooltip__warning">
          {"Гекс мёртв: здание ничего не произведёт"}
        </div>
      ) : null}

      {refusal === null && !isDead(hex) && isFoodBlocked(hex) && building.yields === "food" ? (
        <div className="hex-tooltip__warning">
          {"Токсичность выше 50%: еду здесь не вырастить"}
        </div>
      ) : null}

      {refusal ? (
        <div className="hex-tooltip__warning">
          {refusal.message}
        </div>
      ) : null}
    </div>
  );
};

type TRollLineProps = {
  hex: THex;
  roll: TTaxRoll;
  effects: TPayoutEffects;
};

/** The tax phase line of the tooltip: the face this die will pay. */
const RollLine: FC<TRollLineProps> = ({ hex, roll, effects }) => {
  const face = roll.faces[roll.chosenIndex];
  if (!face) {
    return null;
  }

  const paid = facePayout(face, hex, effects);
  const isPicked = roll.chosenIndex !== roll.rolledIndex;

  return (
    <div className="hex-tooltip__row hex-tooltip__roll">
      {isPicked ? "Выбрано: " : "Выпало: "}
      <Icon src={getResource(face.resource).icon} label={getResource(face.resource).label} />
      {`+${paid.amount}`}
      {" · "}
      <Icon src={ICONS.toxicity} label="Токсичность" />
      {`+${paid.toxicity}%`}
      {isPicked ? <Icon src={ICONS.power} label="Выбрано за власть" /> : null}
    </div>
  );
};

/**
 * The hover popup of the spec: the name of what stands on the hex and the
 * resource combinations its die can roll. The stronghold has a die too. An
 * empty hex only names its biome. In the tax phase the popup also shows the
 * face the die will pay.
 */
const HexTooltip = () => {
  useSignals();
  const store = useStore();
  const hex = store.derived.hoveredHex.value;
  const anchor = store.ui.hoverAnchor.value;
  const player = store.derived.viewedPlayer.value;
  const isSetup = store.game.stage.value === "setup";
  const isPlay = store.game.stage.value === "play";
  const armedId = store.ui.armedBuilding.value;
  const isReadonly = store.derived.isReadonly.value;
  const effects = store.derived.techEffects.value;
  const taxPlan = store.derived.humanTaxPlan.value;
  const isTaxOpen = store.game.tax.value?.status === "rolled";

  if (!hex || !anchor) {
    return null;
  }

  if (isPlay && armedId && player && !isReadonly) {
    return (
      <BuildPreview
        hex={hex}
        building={getBuilding(armedId)}
        player={player}
        stoneDiscount={effects.stoneDiscount}
        anchor={anchor}
      />
    );
  }

  const biome = getBiome(hex.biome);
  const die = hexDie(player, hex);
  const isStronghold = isStrongholdHex(player, hex.id);
  const roll = isReadonly ? null : findRoll(taxPlan, hex.id);
  const canPlace = isSetup && player !== null && canPlaceStronghold(player.island, hex.id);

  return (
    <div className="hex-tooltip" style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}>
      <div className="hex-tooltip__title">
        {die ? <Icon src={die.art} size="m" /> : null}
        {die ? die.label : biome.label}
      </div>

      {die ? (
        <div className="hex-tooltip__subtitle">
          {biome.label}
        </div>
      ) : null}

      {die ? (
        <DieFaces faces={die.faces} biomeFaceIndex={die.biomeFaceIndex} biomeLabel={biome.label} />
      ) : (
        <div className="hex-tooltip__empty">
          {"Свободный гекс"}
        </div>
      )}

      {die ? (
        <div className="hex-tooltip__row">
          {"В среднем: "}
          <DieAverage die={die} />
        </div>
      ) : null}

      {isStronghold ? (
        <div className="hex-tooltip__row">
          <Icon src={ICONS.power} label="Власть" />
          {`+${POWER_PER_TURN} власть за ход. Снести нельзя.`}
        </div>
      ) : null}

      <StructureHpLine player={player} hex={hex} className="hex-tooltip__row" />

      {roll ? <RollLine hex={hex} roll={roll} effects={effects} /> : null}

      {roll && isTaxOpen ? (
        <div className="hex-tooltip__action">
          {"Клик — сменить грань за власть"}
        </div>
      ) : null}

      {canPlace ? (
        <div className="hex-tooltip__action">
          {"Клик — поставить твердыню"}
        </div>
      ) : null}

      {hex.toxicity > 0 ? (
        <div className="hex-tooltip__toxicity">
          {`Токсичность гекса: ${Math.round(hex.toxicity)}%`}
        </div>
      ) : null}

      {isDead(hex) ? (
        <div className="hex-tooltip__warning">
          {"Гекс мёртв: ничего не производит"}
        </div>
      ) : null}

      {!isDead(hex) && isFoodBlocked(hex) ? (
        <div className="hex-tooltip__warning">
          {"Токсичность выше 50%: еду здесь не вырастить"}
        </div>
      ) : null}
    </div>
  );
};

export { HexTooltip };
