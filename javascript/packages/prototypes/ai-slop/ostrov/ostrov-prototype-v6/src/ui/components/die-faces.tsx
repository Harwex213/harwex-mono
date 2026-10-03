import { dieAverages, dieResources } from "../../core/dice";
import { ICONS } from "../../core/icons";
import { getResource } from "../../core/resources";
import { effectiveYield } from "../../core/tax";
import { Icon } from "./icon";
import type { FC } from "react";
import type { THexDie } from "../../core/dice";
import type { TFace, THex } from "../../core/types";

type TDieFacesProps = {
  faces: readonly TFace[];
  /** Index of the biome face, marked with a gold rim. -1 when there is none. */
  biomeFaceIndex: number;
  biomeLabel: string;
  /** When given, each face shows what the hex's toxicity leaves of it. */
  hex?: THex | null;
};

/**
 * The faces of one die as a row of chips: yield and toxicity per face. The
 * hover tooltip, the build preview and the hex modal all draw a die this way.
 */
const DieFaces: FC<TDieFacesProps> = ({ faces, biomeFaceIndex, biomeLabel, hex = null }) => {
  return (
    <div className="hex-tooltip__faces">
      {faces.map((item, index) => {
        const paid = hex ? effectiveYield(item, hex) : item.amount;
        const isBiomeFace = index === biomeFaceIndex;

        return (
          <span
            className={`face ${isBiomeFace ? "face--biome" : ""}`}
            key={`${item.resource}-${item.amount}-${item.toxicity}-${index}`}
            title={isBiomeFace ? `Грань биома «${biomeLabel}»` : undefined}
          >
            <span className="face__yield">
              <Icon src={getResource(item.resource).icon} label={getResource(item.resource).label} />
              {paid === item.amount ? item.amount : `${item.amount}→${paid}`}
            </span>

            <span className="face__toxicity">
              <Icon src={ICONS.toxicity} label="Токсичность" />
              {item.toxicity}
            </span>
          </span>
        );
      })}
    </div>
  );
};

type TDieAverageProps = {
  die: THexDie;
};

/**
 * "В среднем" for a die: the mean yield and the mean toxicity of one roll.
 * A mixed die, the stronghold's, shows every resource it can pay.
 */
const DieAverage: FC<TDieAverageProps> = ({ die }) => {
  const averages = dieAverages(die);

  return (
    <span className="die-average">
      {dieResources(die).map((resource) => (
        <Icon key={resource} src={getResource(resource).icon} label={getResource(resource).label} />
      ))}
      {averages.amount.toFixed(1)}
      {" · "}
      <Icon src={ICONS.toxicity} label="Токсичность" />
      {averages.toxicity.toFixed(1)}
    </span>
  );
};

export { DieAverage, DieFaces };
