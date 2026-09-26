import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../core/biomes";
import { facesOn, getBuilding } from "../../core/buildings";
import { getResource } from "../../core/resources";
import { isDead, isFoodBlocked } from "../../core/tax";
import { useStore } from "../../store/store";

/**
 * The hover popup of the spec: the name of the building on the hex and the
 * resource combinations it can roll. An empty hex only names its biome.
 */
const HexTooltip = () => {
  useSignals();
  const store = useStore();
  const hex = store.derived.hoveredHex.value;
  const anchor = store.ui.hoverAnchor.value;

  if (!hex || !anchor) {
    return null;
  }

  const biome = getBiome(hex.biome);
  const building = hex.building ? getBuilding(hex.building) : null;

  return (
    <div className="hex-tooltip" style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}>
      <div className="hex-tooltip__title">
        {building ? building.label : biome.label}
      </div>

      {building ? (
        <div className="hex-tooltip__subtitle">
          {biome.label}
        </div>
      ) : null}

      {building ? (
        <div className="hex-tooltip__faces">
          {facesOn(building, hex.biome).map((item, index) => (
            <span className="face" key={`${item.resource}-${item.amount}-${item.toxicity}-${index}`}>
              <span className="face__yield">
                {`${getResource(item.resource).emoji} ${item.amount}`}
              </span>

              <span className="face__toxicity">
                {`☣️ ${item.toxicity}`}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div className="hex-tooltip__empty">
          {"Свободный гекс"}
        </div>
      )}

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
