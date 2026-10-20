import { useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  CountryPanel,
  type TCountryPanelRegistry,
} from "../../widgets/country-panel/country-panel";
import { CountryPlaque } from "../../widgets/country-plaque/country-plaque";
import { MapCanvas } from "../../widgets/map-canvas/map-canvas";
import { useStore } from "../../../store/index";
import type { TAppRegistry } from "../../../actions/index";
import type { TMapCanvasServiceRegistry } from "../../../services/index";
import styles from "./map-page.module.css";

type TMapPageRegistry = Pick<TAppRegistry, "resetView" | "setAssignMode"> &
  TCountryPanelRegistry &
  TMapCanvasServiceRegistry;

type TMapPageProps = {
  registry: TMapPageRegistry;
};

// The screen: a full-bleed map with controls positioned over it.
// Every control is a sibling of the map host, not a child, so its pointer events
// never reach the map and it needs no `data-hud-control`.

function MapPage({ registry }: TMapPageProps) {
  useSignals();
  const store = useStore();

  const mode = store.assign.mode.value;
  const activeId = store.assign.activeCountryId.value;
  const activeCountry =
    activeId === null ? null : store.world.countryById.value.get(activeId) ?? null;

  // The single Escape listener in the app, so one press does one predictable thing.
  // Escape works inside a text field too: fields commit on their own, so no draft is lost.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (store.assign.mode.peek()) {
        registry.setAssignMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store, registry]);

  return (
    <div className={styles.shell} data-mode={mode ? "assign" : "pan"}>
      <div className={styles.mapLayer}>
        <MapCanvas registry={registry} />
      </div>

      {/* The rail spans the window. Its CSS lets clicks through to the map outside the plaque. */}
      <div className={styles.plaqueRail}>
        <CountryPlaque />
        {mode ? (
          <div className={styles.assignBanner}>
            {activeCountry === null ? null : (
              <span
                className={styles.assignSwatch}
                style={{ background: activeCountry.colorHex }}
              />
            )}
            <span>
              {activeCountry === null
                ? "assign mode · no country picked — the left button still pans"
                : "assign mode · " +
                  activeCountry.name +
                  " · left drag paints · alt erases · esc exits"}
            </span>
          </div>
        ) : null}
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

      {/* A ring around the viewport keeps assign mode visible away from the banner. */}
      {mode ? <div className={styles.assignRail} /> : null}
    </div>
  );
}

export { MapPage };
