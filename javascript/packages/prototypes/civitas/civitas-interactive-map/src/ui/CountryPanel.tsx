import { useEffect, useRef, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  activeCountryId,
  assignMode,
  setActiveCountry,
  toggleAssignMode,
} from "../state/assign-store";
import { addCountry, countries, deleteCountry, updateCountry } from "../state/world-store";
import { countryAggregates } from "../state/country-store";
import { selectCountry, selectedCountryId } from "../state/selection-store";
import type { MouseEvent as ReactMouseEvent } from "react";
import styles from "./country-panel.module.css";

// The country CRUD surface and the assignment-mode toggle. Deliberately minimal
// chrome — T08 restyles it inside the real shell and T09 replaces it with the
// country overview panel. It is mounted as a SIBLING of `MapCanvas`, so its
// pointer events never reach the map host and it needs no `data-hud-control`
// guard.

// React's `onChange` on an input fires on the native `input` event, and dragging
// inside the OS colour picker emits dozens a second. Each one would replace the
// countries array and repaint every province of that country — about 20 ms for a
// 300-province country, i.e. a UI locked for as long as the drag lasts.
const COLOR_DEBOUNCE_MS = 80;
const CONFIRM_MS = 3000;

type ColorPending = { id: number; hex: string };

function CountryRow(props: {
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
    setActiveCountry(props.countryId);
    // A row click also SELECTS the country, so the plaque and the three panels
    // follow. `selectCountry` keeps the currently selected province only when
    // that province is inside this country.
    selectCountry(props.countryId);
  }

  function onDelete(): void {
    if (!props.armed) {
      props.onArm(props.countryId);
      return;
    }
    props.onArm(null);
    deleteCountry(props.countryId);
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
          type="text"
          value={props.name}
          onChange={(event) => {
            updateCountry(props.countryId, { name: event.target.value });
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

function CountryPanel() {
  useSignals();

  // A misclick that deletes a 300-province country with no undo is not
  // acceptable, so the button arms first and only the second click within
  // `CONFIRM_MS` deletes.
  const [armedId, setArmedId] = useState<number | null>(null);
  // The displayed colour is local so the input stays responsive while the store
  // write is debounced behind it.
  const [pendingColor, setPendingColor] = useState<ColorPending | null>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorLatest = useRef<ColorPending | null>(null);

  const list = countries.value;
  const active = activeCountryId.value;
  const selected = selectedCountryId.value;
  const mode = assignMode.value;
  const aggregates = countryAggregates.value;

  // Writes the newest colour the picker produced. A fixed-window trailing
  // debounce, the same shape `createStateWriter` uses.
  function commitColor(): void {
    const latest = colorLatest.current;
    colorLatest.current = null;
    if (latest === null) {
      return;
    }
    updateCountry(latest.id, { colorHex: latest.hex });
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

  // The last drag position must not be lost when the panel unmounts, and the
  // pending timer must not fire into a dead component.
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

  // NO Escape listener here. T08 moved it to `Shell`, which owns the single
  // window handler: it closes the open panel first and leaves assign mode
  // second. Two independent listeners on one key means a press does two things
  // and neither is predictable.

  function onNew(): void {
    const country = addCountry();
    setActiveCountry(country.id);
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
          onClick={toggleAssignMode}
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

export { CountryPanel };
