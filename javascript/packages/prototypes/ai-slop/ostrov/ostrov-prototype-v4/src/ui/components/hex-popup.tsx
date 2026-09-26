import { useSignals } from "@preact/signals-react/runtime";
import { BIOMES, BUILDINGS, BUILDING_ORDER, DEAD_HEX_TOXICITY, hexYield } from "../../core/exports";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBiomeId, TBuildingId, THex, TResourceId, TTechId } from "../../core/exports";

/**
 * The hover card of the island canvas (spec node `island-canvas`): what stands
 * on the hex and what it pays, or — on an empty hex — everything that could
 * stand there.
 */

/** The same ten glyphs the resources panel prints, `01-spec-image-6.png`. */
const RESOURCE_GLYPHS: Readonly<Record<TResourceId, string>> = {
  food: "🍗",
  stone: "🪨",
  wood: "🪵",
  population: "🧍",
  hammers: "⚒️",
  science: "📖",
  scouting: "🔭",
  mana: "💠",
  toxicity: "☣️",
  insane: "🤖",
};

const EMPTY_HEX_RU = "Пусто";
const DEAD_HEX_RU = "Гекс мёртв: ничего не растёт и ничего не строится";
const NOTHING_FITS_RU = "Сюда ничего не поставить";
const TOXICITY_LABEL_RU = "Токсичность";

/** Distance from the cursor to the popup corner, in pixels. */
const POPUP_OFFSET_PX = 18;
const POPUP_WIDTH_PX = 240;
const POPUP_HEIGHT_PX = 220;

/** The buildings whose yield table lists this biome, in panel order. */
const buildingsForBiome = (biome: TBiomeId): readonly TBuildingId[] => {
  return BUILDING_ORDER.filter((building) => BUILDINGS[building].yields[biome] !== undefined);
};

const comboText = (resource: TResourceId, amount: number, toxicity: number): string => {
  return `${RESOURCE_GLYPHS[resource]} ${amount} ${RESOURCE_GLYPHS.toxicity} ${toxicity}`;
};

const BuiltBody: FC<{ hex: THex; building: TBuildingId; researched: readonly TTechId[] }> = ({
  hex,
  building,
  researched,
}) => {
  const entry = hexYield(hex, researched);
  const info = BUILDINGS[building];

  return (
    <div className="hex-popup__combo">
      {entry === null ? DEAD_HEX_RU : comboText(info.produces, entry.amount, entry.toxicity)}
    </div>
  );
};

const EmptyBody: FC<{ biome: TBiomeId }> = ({ biome }) => {
  const options = buildingsForBiome(biome);
  if (options.length === 0) {
    return (
      <div className="hex-popup__combo">
        {NOTHING_FITS_RU}
      </div>
    );
  }

  return (
    <div className="hex-popup__list">
      {options.map((building) => {
        const info = BUILDINGS[building];
        const table = info.yields[biome];

        return (
          <div key={building} className="hex-popup__row">
            <span className="hex-popup__row-name">
              {info.nameRu}
            </span>

            <span className="hex-popup__row-combo">
              {table === undefined ? "" : comboText(info.produces, table.amount, table.toxicity)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const HexPopup: FC = () => {
  useSignals();

  const store = useStore();
  const hoveredHexId = store.ui.hoveredHexId.value;
  const screen = store.ui.hoverScreen.value;
  const island = store.derived.viewedIsland.value;
  const researched = store.game.researched.value;
  if (hoveredHexId === null || screen === null || island === null) {
    return null;
  }

  const hex = island.hexes[hoveredHexId];
  if (hex === undefined) {
    return null;
  }

  const flipX = screen.x + POPUP_OFFSET_PX + POPUP_WIDTH_PX > window.innerWidth;
  const flipY = screen.y + POPUP_OFFSET_PX + POPUP_HEIGHT_PX > window.innerHeight;
  const left = flipX ? screen.x - POPUP_OFFSET_PX - POPUP_WIDTH_PX : screen.x + POPUP_OFFSET_PX;
  const top = flipY ? Math.max(0, screen.y - POPUP_OFFSET_PX - POPUP_HEIGHT_PX) : screen.y + POPUP_OFFSET_PX;

  return (
    <div className="hex-popup" style={{ left: `${left}px`, top: `${top}px`, width: `${POPUP_WIDTH_PX}px` }}>
      <div className="hex-popup__title">
        {hex.building === null ? EMPTY_HEX_RU : BUILDINGS[hex.building].nameRu}
      </div>

      <div className="hex-popup__biome">
        {BIOMES[hex.biome].nameRu}
      </div>

      {hex.building === null ? (
        <EmptyBody biome={hex.biome} />
      ) : (
        <BuiltBody hex={hex} building={hex.building} researched={researched} />
      )}

      <div className={hex.toxicity >= DEAD_HEX_TOXICITY ? "hex-popup__toxicity hex-popup__toxicity--dead" : "hex-popup__toxicity"}>
        {`${RESOURCE_GLYPHS.toxicity} ${TOXICITY_LABEL_RU}: ${hex.toxicity}`}
      </div>
    </div>
  );
};

export { HexPopup, RESOURCE_GLYPHS };
