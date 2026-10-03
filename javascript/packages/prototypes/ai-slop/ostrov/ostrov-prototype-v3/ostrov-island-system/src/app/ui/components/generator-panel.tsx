import { TERRAIN_COLORS } from "../palette";
import { Island } from "../../../core/exports";
import { TERRAIN_LABELS } from "../../../core/island/terrain";
import { boardCellCount } from "../../../core/hex/grid";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { ChangeEvent, FC } from "react";
import type { TResetConfigAction, TSetConfigValueAction, TSetTerrainWeightAction } from "../../domain/registry";

/** The terrain sliders are weights, so the scale is arbitrary. */
const MAX_WEIGHT = 100;

type TPanelSliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  /** What the slider actually produced, shown on the right of the label. */
  readout: string | number;
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
  setConfigValueAction: TSetConfigValueAction;
  setTerrainWeightAction: TSetTerrainWeightAction;
  resetConfigAction: TResetConfigAction;
};

type TGeneratorPanelProps = {
  registry: TGeneratorPanelRegistrySlice;
};

const GeneratorPanel: FC<TGeneratorPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const island = store.islandState.island.value;
  const config = store.islandState.config.value;
  const radiusRange = Island.CONFIG_RANGES.boardRadius;
  const landRange = Island.CONFIG_RANGES.landCount;

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{"Поле"}</h2>
          <button className="panel__reset" type="button" onClick={registry.resetConfigAction}>
            {"Сбросить"}
          </button>
        </div>

        <PanelSlider
          id="board-radius"
          label="Радиус поля"
          min={radiusRange.min}
          max={radiusRange.max}
          value={config.boardRadius}
          readout={`${config.boardRadius} · ${boardCellCount(config.boardRadius)} кл.`}
          onChange={(value) => registry.setConfigValueAction("boardRadius", value)}
        />

        <PanelSlider
          id="land-count"
          label="Клеток суши"
          min={landRange.min}
          max={Math.min(landRange.max, island.boardSize)}
          value={Math.min(config.landCount, island.boardSize)}
          readout={island.landCount}
          onChange={(value) => registry.setConfigValueAction("landCount", value)}
        />
      </section>

      <section className="panel">
        <h2 className="panel__title">{"Типы клеток"}</h2>

        {Island.TERRAINS.map((terrain) => (
          <PanelSlider
            key={terrain}
            id={`weight-${terrain}`}
            label={TERRAIN_LABELS[terrain]}
            swatch={TERRAIN_COLORS[terrain]}
            min={0}
            max={MAX_WEIGHT}
            value={config.terrainWeights[terrain]}
            readout={island.counts[terrain]}
            onChange={(weight) => registry.setTerrainWeightAction(terrain, weight)}
          />
        ))}
      </section>
    </>
  );
};

export { GeneratorPanel };
