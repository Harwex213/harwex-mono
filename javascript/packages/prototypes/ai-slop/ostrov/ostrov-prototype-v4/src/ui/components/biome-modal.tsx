import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { BIOMES, BUILDINGS, DEAD_HEX_TOXICITY, hexYield } from "../../core/exports";
import { RESOURCE_GLYPHS } from "./hex-popup";
import { paintBiomeSwatch } from "../island-canvas/draw-island";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSelectHexAction } from "../../domain/registry";

/**
 * The right-side panel a click on a hex opens (plan §4.4): the biome swatch at
 * a readable size, its name and description, the hex toxicity and whatever
 * stands on it.
 */

type TBiomeModalRegistrySlice = {
  selectHex: TSelectHexAction;
};

type TBiomeModalProps = {
  registry: TBiomeModalRegistrySlice;
};

const SWATCH_WIDTH_PX = 268;
const SWATCH_HEIGHT_PX = 120;
const DEFAULT_DPR = 1;

const CLOSE_LABEL = "×";
const EMPTY_HEX_RU = "Гекс пуст";
const DEAD_HEX_RU = "Гекс мёртв";
const TOXICITY_LABEL_RU = "Токсичность";
const YIELD_LABEL_RU = "Даёт за ход";

const BiomeModal: FC<TBiomeModalProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const swatchRef = useRef<HTMLCanvasElement>(null);
  const selectedHexId = store.ui.selectedHexId.value;
  const island = store.derived.viewedIsland.value;
  const researched = store.game.researched.value;
  const hex = island === null || selectedHexId === null ? undefined : island.hexes[selectedHexId];
  const biome = hex === undefined ? null : hex.biome;

  useEffect(() => {
    const canvas = swatchRef.current;
    if (canvas === null || biome === null) {
      return;
    }

    const dpr = window.devicePixelRatio || DEFAULT_DPR;
    canvas.width = Math.round(SWATCH_WIDTH_PX * dpr);
    canvas.height = Math.round(SWATCH_HEIGHT_PX * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBiomeSwatch(ctx, biome, SWATCH_WIDTH_PX, SWATCH_HEIGHT_PX);
    ctx.font = "64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(BIOMES[biome].glyph, SWATCH_WIDTH_PX / 2, SWATCH_HEIGHT_PX / 2);
    ctx.globalAlpha = 1;
  }, [biome]);

  if (hex === undefined || biome === null) {
    return null;
  }

  const info = BIOMES[biome];
  const entry = hexYield(hex, researched);

  return (
    <div className="biome-modal">
      <button
        type="button"
        className="biome-modal__close"
        aria-label="Закрыть"
        onClick={() => registry.selectHex(null)}
      >
        {CLOSE_LABEL}
      </button>

      <canvas
        ref={swatchRef}
        className="biome-modal__swatch"
        style={{ width: `${SWATCH_WIDTH_PX}px`, height: `${SWATCH_HEIGHT_PX}px` }}
      />

      <h3 className="biome-modal__title">
        {info.nameRu}
      </h3>

      <p className="biome-modal__description">
        {info.descriptionRu}
      </p>

      <div className={hex.toxicity >= DEAD_HEX_TOXICITY ? "biome-modal__toxicity biome-modal__toxicity--dead" : "biome-modal__toxicity"}>
        {`${RESOURCE_GLYPHS.toxicity} ${TOXICITY_LABEL_RU}: ${hex.toxicity} / ${DEAD_HEX_TOXICITY}`}
      </div>

      <div className="biome-modal__building">
        {hex.building === null ? EMPTY_HEX_RU : BUILDINGS[hex.building].nameRu}
      </div>

      {hex.building === null ? null : (
        <div className="biome-modal__yield">
          {entry === null
            ? DEAD_HEX_RU
            : `${YIELD_LABEL_RU}: ${RESOURCE_GLYPHS[entry.resource]} ${entry.amount} ${RESOURCE_GLYPHS.toxicity} ${entry.toxicity}`}
        </div>
      )}
    </div>
  );
};

export type { TBiomeModalRegistrySlice };
export { BiomeModal };
