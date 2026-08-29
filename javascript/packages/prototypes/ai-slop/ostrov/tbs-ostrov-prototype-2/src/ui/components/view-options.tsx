import { useSignals } from "@preact/signals-react/runtime";
import { MAX_ZOOM, MIN_ZOOM } from "../../domain/hex/camera";
import { useStore } from "../../store/store";
import type { TFitMapAction, TSetZoomAction, TToggleViewOptionAction } from "../../domain/registry";
import type { TToggleKey } from "../../domain/view-state";
import type { ChangeEvent, FC } from "react";

type TViewOptionsRegistrySlice = {
  setZoomAction: TSetZoomAction;
  fitMapAction: TFitMapAction;
  toggleViewOptionAction: TToggleViewOptionAction;
};

type TViewOptionsProps = {
  registry: TViewOptionsRegistrySlice;
};

const TOGGLES: readonly { key: TToggleKey; label: string }[] = [
  { key: "showGrid", label: "Hex grid" },
  { key: "showIslandOutlines", label: "Island outlines" },
  { key: "showElevationShading", label: "Elevation shading" },
];

/**
 * The zoom range spans a factor of about seventy, so the slider is logarithmic.
 * On a linear one the whole zoomed-out half of the range would live in the first
 * few pixels.
 */
const ZOOM_SPAN = Math.log(MAX_ZOOM / MIN_ZOOM);

const zoomFromSlider = (position: number): number => MIN_ZOOM * Math.exp((position / 100) * ZOOM_SPAN);

const sliderFromZoom = (zoom: number): number => (100 * Math.log(zoom / MIN_ZOOM)) / ZOOM_SPAN;

const ViewOptions: FC<TViewOptionsProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const zoom = store.viewState.zoom.value;

  const handleZoomChange = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setZoomAction(zoomFromSlider(Number(event.target.value)));
  };

  return (
    <section className="panel">
      <h2 className="panel__title">{"View"}</h2>

      <label className="param">
        <span className="param__head">
          <span className="param__label">{"Zoom"}</span>
          <span className="param__value">{`${zoom.toFixed(1)} px / hex`}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={sliderFromZoom(zoom)}
          onChange={handleZoomChange}
        />
      </label>

      <div className="panel__buttons">
        <button type="button" className="button" onClick={registry.fitMapAction}>
          {"Fit whole map"}
        </button>
      </div>

      <div className="toggles">
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="toggle">
            <input
              type="checkbox"
              checked={store.viewState[toggle.key].value}
              onChange={() => registry.toggleViewOptionAction(toggle.key)}
            />
            <span>{toggle.label}</span>
          </label>
        ))}
      </div>

      <p className="panel__hint">{"Drag to pan, scroll to zoom, click an island to isolate it."}</p>
    </section>
  );
};

export { ViewOptions };
