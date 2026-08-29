import { useSignals } from "@preact/signals-react/runtime";
import { MAP_SIZE_STEP, MAX_MAP_SIZE, MIN_MAP_SIZE, PARAM_FIELDS } from "../../domain/generator/params";
import { useStore } from "../../store/store";
import { ParamSlider } from "./param-slider";
import type {
  TGenerateMapAction,
  TRandomizeSeedAction,
  TResetParamsAction,
  TSetMapSizeAction,
  TSetParamAction,
  TSetSeedAction,
} from "../../domain/registry";
import type { ChangeEvent, FC, KeyboardEvent } from "react";

type TGeneratorPanelRegistrySlice = {
  generateMapAction: TGenerateMapAction;
  setSeedAction: TSetSeedAction;
  setParamAction: TSetParamAction;
  setMapSizeAction: TSetMapSizeAction;
  randomizeSeedAction: TRandomizeSeedAction;
  resetParamsAction: TResetParamsAction;
};

type TGeneratorPanelProps = {
  registry: TGeneratorPanelRegistrySlice;
};

const GeneratorPanel: FC<TGeneratorPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const params = store.generatorState.params.value;

  const handleSeedChange = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setSeedAction(event.target.value);
  };

  const handleMapSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setMapSizeAction(Number(event.target.value));
  };

  const handleSeedKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    registry.generateMapAction();
  };

  return (
    <section className="panel">
      <h2 className="panel__title">{"Generator"}</h2>

      <label className="param param--text">
        <span className="param__head">
          <span className="param__label">{"Seed"}</span>
        </span>
        <input type="text" value={params.seed} onChange={handleSeedChange} onKeyDown={handleSeedKeyDown} />
      </label>

      <label
        className="param"
        title="Side of the square map, in hexes. The island count is scaled with the area to match."
      >
        <span className="param__head">
          <span className="param__label">{"Map size"}</span>
          <span className="param__value">
            {`${params.width} × ${params.height} = ${(params.width * params.height).toLocaleString("en-US")}`}
          </span>
        </span>
        <input
          type="range"
          min={MIN_MAP_SIZE}
          max={MAX_MAP_SIZE}
          step={MAP_SIZE_STEP}
          value={params.width}
          onChange={handleMapSizeChange}
        />
      </label>

      <div className="panel__buttons">
        <button type="button" className="button button--primary" onClick={registry.generateMapAction}>
          {"Generate"}
        </button>
        <button type="button" className="button" onClick={registry.randomizeSeedAction}>
          {"Random seed"}
        </button>
        <button type="button" className="button" onClick={registry.resetParamsAction}>
          {"Reset"}
        </button>
      </div>

      <div className="panel__params">
        {PARAM_FIELDS.map((field) => (
          <ParamSlider
            key={field.key}
            field={field}
            value={params[field.key]}
            onChange={registry.setParamAction}
          />
        ))}
      </div>
    </section>
  );
};

export { GeneratorPanel };
