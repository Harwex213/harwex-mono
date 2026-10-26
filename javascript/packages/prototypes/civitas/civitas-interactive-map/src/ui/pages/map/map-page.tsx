import {
  CountryPanel,
  type TCountryPanelRegistry,
} from "../../widgets/country-panel/country-panel";
import { CountryPlaque } from "../../widgets/country-plaque/country-plaque";
import { MapCanvas } from "../../widgets/map-canvas/map-canvas";
import type { TAppRegistry } from "../../../actions/index";
import type { TMapCanvasServiceRegistry } from "../../../services/index";
import styles from "./map-page.module.css";

type TMapPageRegistry = Pick<TAppRegistry, "resetView"> &
  TCountryPanelRegistry &
  TMapCanvasServiceRegistry;

type TMapPageProps = {
  registry: TMapPageRegistry;
};

// The screen: a full-bleed map with controls positioned over it.
// Every control is a sibling of the map host, not a child, so its pointer events
// never reach the map and it needs no `data-hud-control`.

function MapPage({ registry }: TMapPageProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.mapLayer}>
        <MapCanvas registry={registry} />
      </div>

      {/* The rail spans the window. Its CSS lets clicks through to the map outside the plaque. */}
      <div className={styles.plaqueRail}>
        <CountryPlaque />
      </div>

      <CountryPanel registry={registry} />

      <div className={styles.bar}>
        {/* An action, not a toggle. Never disabled: a button that greys out on a fitted view confuses more than a no-op click. */}
        <button
          className={styles.barAction}
          title="Reset view (0)"
          type="button"
          onClick={() => {
            registry.resetView();
          }}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

export { MapPage };
