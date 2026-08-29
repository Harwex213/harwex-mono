import { ISLAND_TYPE_LABELS, ISLAND_TYPE_LIST } from "@hw/ostrov-island-system";
import { ISLAND_TYPE_COLORS } from "../palette";
import { ISLAND_TOTAL_MAX, ISLAND_TOTAL_RANGE, freeIslandSlots, totalIslandCount } from "../../../core/world/config";
import { World } from "../../../core/exports";
import { rangeSize } from "../../../core/hex/offset";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { ChangeEvent, FC } from "react";
import type { TAxisConfigKey, TRangeBound, TRangeConfigKey } from "../../../core/exports";
import type {
  TResetConfigAction,
  TSetAxisSizeAction,
  TSetIslandTotalAction,
  TSetIslandTypeCountAction,
  TSetRangeBoundAction,
} from "../../domain/registry";

type TPanelSliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What the slider actually produced, shown on the right of the label. */
  readout: string | number;
  swatch?: string;
  onChange: (value: number) => void;
};

const PanelSlider: FC<TPanelSliderProps> = ({ id, label, min, max, step, value, readout, swatch, onChange }) => {
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

      <input
        id={id}
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onInput}
      />
    </div>
  );
};

type TWorldPanelRegistrySlice = {
  setAxisSizeAction: TSetAxisSizeAction;
  setIslandTotalAction: TSetIslandTotalAction;
  setRangeBoundAction: TSetRangeBoundAction;
  setIslandTypeCountAction: TSetIslandTypeCountAction;
  resetConfigAction: TResetConfigAction;
};

type TWorldPanelProps = {
  registry: TWorldPanelRegistrySlice;
};

const WorldPanel: FC<TWorldPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const world = store.worldState.world.value;
  const config = store.worldState.config.value;
  const counts = config.islandTypeCounts;
  const free = freeIslandSlots(counts);
  const total = totalIslandCount(counts);

  const axis = (key: TAxisConfigKey, label: string) => {
    const limits = World.CONFIG_RANGES[key];
    const size = rangeSize(config[key]);

    return (
      <PanelSlider
        id={`${key}-size`}
        label={label}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={size}
        readout={size}
        onChange={(value) => registry.setAxisSizeAction(key, value)}
      />
    );
  };

  const bound = (key: TRangeConfigKey, side: TRangeBound, label: string) => {
    const limits = World.CONFIG_RANGES[key];

    return (
      <PanelSlider
        id={`${key}-${side}`}
        label={label}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={config[key][side]}
        readout={config[key][side]}
        onChange={(value) => registry.setRangeBoundAction(key, side, value)}
      />
    );
  };

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{"Границы мира"}</h2>
          <button className="panel__reset" type="button" onClick={registry.resetConfigAction}>
            {"Сбросить"}
          </button>
        </div>

        {axis("xRange", "Клеток по X")}
        {axis("yRange", "Клеток по Y")}

        <p className="panel__hint">{`${world.width} × ${world.height} = ${world.cellCount} клеток`}</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">{"Острова"}</h2>

        {/* The total and the archetype sliders describe the same islands. Moving
            this one rescales the archetypes and keeps the mix they stand for. */}
        <PanelSlider
          id="island-total"
          label="Количество"
          min={ISLAND_TOTAL_RANGE.min}
          max={ISLAND_TOTAL_RANGE.max}
          step={ISLAND_TOTAL_RANGE.step}
          value={total}
          readout={world.islands.length === total ? total : `${world.islands.length} из ${total}`}
          onChange={registry.setIslandTotalAction}
        />

        {bound("islandTiles", "min", "Клеток от")}
        {bound("islandTiles", "max", "Клеток до")}

        <p className="panel__hint">{"Между двумя островами всегда остаётся минимум одна пустая клетка моря."}</p>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{"Типы островов"}</h2>
          <span className={`panel__budget${free === 0 ? " panel__budget--empty" : ""}`}>
            {`${total} из ${ISLAND_TOTAL_MAX}`}
          </span>
        </div>

        {/* Each slider is a count of islands, and the five share one world. A
            slider may ask for more than the world has room for; the action holds
            it at the free slots, so raising one type means lowering another. */}
        {ISLAND_TYPE_LIST.map((type) => {
          const placed = world.islands.filter((island) => island.type === type).length;

          return (
            <PanelSlider
              key={type}
              id={`type-${type}`}
              label={ISLAND_TYPE_LABELS[type]}
              swatch={ISLAND_TYPE_COLORS[type]}
              min={0}
              max={ISLAND_TOTAL_MAX}
              step={1}
              value={counts[type]}
              readout={placed === counts[type] ? counts[type] : `${placed} из ${counts[type]}`}
              onChange={(count) => registry.setIslandTypeCountAction(type, count)}
            />
          );
        })}
      </section>
    </>
  );
};

export { WorldPanel };
