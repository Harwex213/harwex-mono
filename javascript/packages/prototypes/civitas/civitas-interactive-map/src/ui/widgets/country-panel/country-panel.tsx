import { useEffect, useRef, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { countryDisplayName } from "../../../domain/index";
import { useStore } from "../../../store/index";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { TAppRegistry } from "../../../actions/index";
import styles from "./country-panel.module.css";

type TCountryPanelRegistry = Pick<
  TAppRegistry,
  | "addCountry"
  | "deleteCountry"
  | "selectCountry"
  | "setActiveCountry"
  | "toggleAssignMode"
  | "updateCountry"
>;

// Creates, edits and deletes countries and toggles assign mode.
// A sibling of `MapCanvas`, so it needs no `data-hud-control`.

// A colour picker drag fires dozens of events a second. Each store write repaints the
// whole country, so writes are debounced to keep the UI responsive.
const COLOR_DEBOUNCE_MS = 80;
const CONFIRM_MS = 3000;

type ColorPending = { id: number; hex: string };

function CountryRow(props: {
  registry: TCountryPanelRegistry;
  countryId: number;
  name: string;
  colorHex: string;
  provinceCount: number;
  pixelCount: number;
  active: boolean;
  selected: boolean;
  armed: boolean;
  onArm: (id: number | null) => void;
  onColor: (id: number, hex: string) => void;
}) {
  function onRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (event.target instanceof Element && event.target.closest("input, button") !== null) {
      return;
    }
    props.registry.setActiveCountry(props.countryId);
    // A row click also selects the country, so the plaque follows.
    props.registry.selectCountry(props.countryId);
  }

  function onDelete(): void {
    if (!props.armed) {
      props.onArm(props.countryId);
      return;
    }
    props.onArm(null);
    props.registry.deleteCountry(props.countryId);
  }

  return (
    <div
      className={styles.row}
      data-active={props.active ? "true" : "false"}
      data-selected={props.selected ? "true" : "false"}
      onClick={onRowClick}
    >
      <input
        className={styles.color}
        type="color"
        value={props.colorHex}
        onChange={(event) => {
          props.onColor(props.countryId, event.target.value);
        }}
      />
      <div className={styles.rowBody}>
        <input
          className={styles.name}
          // The value stays raw, so the user can clear it. The placeholder shows the fallback name.
          placeholder={countryDisplayName(props.countryId, "")}
          type="text"
          value={props.name}
          onChange={(event) => {
            props.registry.updateCountry(props.countryId, { name: event.target.value });
          }}
        />
        <span className={styles.stats}>
          {props.provinceCount} prov · {props.pixelCount.toLocaleString()} px
        </span>
      </div>
      <button
        className={styles.delete}
        data-armed={props.armed ? "true" : "false"}
        type="button"
        onClick={onDelete}
      >
        {props.armed ? "delete?" : "delete"}
      </button>
    </div>
  );
}

function CountryPanel({ registry }: { registry: TCountryPanelRegistry }) {
  useSignals();
  const store = useStore();

  // Delete has no undo, so it needs a second click within `CONFIRM_MS`.
  const [armedId, setArmedId] = useState<number | null>(null);
  // Local colour, so the input stays responsive while the store write waits.
  const [pendingColor, setPendingColor] = useState<ColorPending | null>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorLatest = useRef<ColorPending | null>(null);

  const list = store.world.countries.value;
  const active = store.assign.activeCountryId.value;
  const selected = store.selection.selectedCountryId.value;
  const mode = store.assign.mode.value;
  const aggregates = store.labels.aggregates.value;

  // A trailing debounce, like `createStateWriter`.
  function commitColor(): void {
    const latest = colorLatest.current;
    colorLatest.current = null;
    if (latest === null) {
      return;
    }
    registry.updateCountry(latest.id, { colorHex: latest.hex });
  }

  function onColor(id: number, hex: string): void {
    colorLatest.current = { id, hex };
    setPendingColor({ id, hex });
    if (colorTimer.current !== null) {
      return;
    }
    colorTimer.current = setTimeout(() => {
      colorTimer.current = null;
      commitColor();
      setPendingColor(null);
    }, COLOR_DEBOUNCE_MS);
  }

  // On unmount, flush the last colour and stop the timer.
  useEffect(() => {
    return () => {
      if (colorTimer.current !== null) {
        clearTimeout(colorTimer.current);
        colorTimer.current = null;
      }
      commitColor();
    };
  }, []);

  useEffect(() => {
    if (armedId === null) {
      return;
    }
    const handle = setTimeout(() => {
      setArmedId(null);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [armedId]);

  // No Escape listener here: `MapPage` owns the single Escape handler.

  function onNew(): void {
    const country = registry.addCountry();
    registry.setActiveCountry(country.id);
  }

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>Countries</span>
        <button className={styles.action} type="button" onClick={onNew}>
          + new
        </button>
      </header>

      <div className={styles.modeRow}>
        <button
          className={styles.action}
          data-on={mode ? "true" : "false"}
          disabled={active === null}
          title={
            active === null
              ? "pick a country first — assignment needs somewhere to put the provinces"
              : "toggle assignment mode"
          }
          type="button"
          onClick={() => {
            registry.toggleAssignMode();
          }}
        >
          {mode ? "assign: on" : "assign: off"}
        </button>
      </div>
      <p className={styles.hint}>left drag paints · alt erases · middle drag pans</p>

      <div className={styles.list}>
        {list.length === 0 ? (
          <p className={styles.empty}>no countries yet</p>
        ) : (
          list.map((country) => {
            const aggregate = aggregates.get(country.id);
            const shown =
              pendingColor !== null && pendingColor.id === country.id
                ? pendingColor.hex
                : country.colorHex;
            return (
              <CountryRow
                key={country.id}
                registry={registry}
                countryId={country.id}
                name={country.name}
                colorHex={shown}
                provinceCount={aggregate ? aggregate.provinceCount : country.provinceIds.length}
                pixelCount={aggregate ? aggregate.pixelCount : 0}
                active={active === country.id}
                selected={selected === country.id}
                armed={armedId === country.id}
                onArm={setArmedId}
                onColor={onColor}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

export { CountryPanel, type TCountryPanelRegistry };
