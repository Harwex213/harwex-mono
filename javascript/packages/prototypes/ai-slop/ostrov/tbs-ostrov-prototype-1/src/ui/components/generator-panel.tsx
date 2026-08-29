import { TERRAIN_COLORS } from "../palette";
import { TERRAIN_LABELS, TERRAIN_LIST } from "../../domain/island/terrain";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { ChangeEvent, FC } from "react";
import type { TSetLandCountAction, TSetTerrainWeightAction } from "../../domain/registry";

/** Below this an island is too small to show a mix of tile types. */
const MIN_LAND_COUNT = 6;

/** The terrain sliders are weights, so the scale is arbitrary. */
const MAX_WEIGHT = 100;

type TPanelSliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  /** What the slider actually produced, shown on the right of the label. */
  readout: number;
  swatch?: string;
  onChange: (value: number) => void;
};

const PanelSlider: FC<TPanelSliderProps> = ({ id, label, min, max, value, readout, swatch, onChange }) => {
  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value));
  };

  return (
    <div className="slider">
      <label className="slider__head" htmlFor={id}>
        {swatch ? <span className="slider__swatch" style={{ background: swatch }} /> : null}
        <span className="slider__label">{label}</span>
        <span className="slider__readout">{readout}</span>
      </label>

      <input id={id} className="slider__input" type="range" min={min} max={max} value={value} onChange={onInput} />
    </div>
  );
};

type TGeneratorPanelRegistrySlice = {
  setLandCountAction: TSetLandCountAction;
  setTerrainWeightAction: TSetTerrainWeightAction;
};

type TGeneratorPanelProps = {
  registry: TGeneratorPanelRegistrySlice;
};

const GeneratorPanel: FC<TGeneratorPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const island = store.islandState.island.value;
  const landCount = store.islandState.landCount.value;
  const weights = store.islandState.terrainWeights.value;

  return (
    <section className="panel">
      <h2 className="panel__title">{"Генератор"}</h2>

      <PanelSlider
        id="land-count"
        label="Клеток суши"
        min={MIN_LAND_COUNT}
        max={island.boardSize}
        value={landCount}
        readout={island.landCount}
        onChange={registry.setLandCountAction}
      />

      <p className="panel__hint">
        {"Ползунки типов задают доли. Клетки делятся между ними, сумма всегда равна суше."}
      </p>

      {TERRAIN_LIST.map((terrain) => (
        <PanelSlider
          key={terrain}
          id={`weight-${terrain}`}
          label={TERRAIN_LABELS[terrain]}
          swatch={TERRAIN_COLORS[terrain]}
          min={0}
          max={MAX_WEIGHT}
          value={weights[terrain]}
          readout={island.counts[terrain]}
          onChange={(weight) => registry.setTerrainWeightAction(terrain, weight)}
        />
      ))}
    </section>
  );
};

export { GeneratorPanel };
