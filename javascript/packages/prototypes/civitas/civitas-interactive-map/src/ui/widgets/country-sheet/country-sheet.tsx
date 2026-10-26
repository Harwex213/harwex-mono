import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { countryDisplayName } from "../../../domain/index";
import { useStore } from "../../../store/index";
import type { TAppRegistry } from "../../../actions/index";
import { EconomyTab } from "./economy-tab";
import { ProfileTab } from "./profile-tab";
import styles from "./country-sheet.module.css";

type TCountrySheetRegistry = Pick<TAppRegistry, "clearSelection">;

type Tab = "profile" | "economy";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "profile", label: "Анкета" },
  { id: "economy", label: "Экономика" },
];

// The right-hand panel with the registration form and the economy of the
// selected country, from `assets/countries-info.json`. It shows while a country
// is selected. Closing it clears the selection.
// A sibling of `MapCanvas`, so it needs no `data-hud-control`.
function CountrySheet({ registry }: { registry: TCountrySheetRegistry }) {
  useSignals();
  const store = useStore();

  // Kept across countries, so comparing two economies needs no extra clicks.
  const [tab, setTab] = useState<Tab>("profile");

  const country = store.selection.selectedCountry.value;
  if (country === null) {
    return null;
  }

  const info = store.world.info.value.get(country.id) ?? null;
  const aggregate = store.labels.aggregates.value.get(country.id);
  const count = aggregate ? aggregate.provinceCount : country.provinceIds.length;
  const capital = info === null || info.profile.capital === "" ? null : info.profile.capital;

  return (
    <aside className={styles.sheet} aria-label="country details">
      <header className={styles.header}>
        <span className={styles.swatch} style={{ background: country.colorHex }} />
        <div className={styles.heading}>
          <h2 className={styles.name}>{countryDisplayName(country.id, country.name)}</h2>
          <p className={styles.subline}>
            {(capital === null ? "" : "Столица: " + capital + " · ") + count + " пров."}
          </p>
        </div>
        <button
          aria-label="close"
          className={styles.close}
          type="button"
          onClick={() => {
            registry.clearSelection();
          }}
        >
          ✕
        </button>
      </header>

      <div className={styles.tabs} role="tablist">
        {TABS.map((entry) => {
          return (
            <button
              aria-selected={entry.id === tab}
              className={styles.tab}
              key={entry.id}
              role="tab"
              type="button"
              onClick={() => {
                setTab(entry.id);
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className={styles.scroll}>
        {tab === "profile" ? (
          info === null ? (
            <p className={styles.missing}>Анкета не заполнена</p>
          ) : (
            <ProfileTab profile={info.profile} />
          )
        ) : info === null || info.economy === null ? (
          <p className={styles.missing}>Экономика ещё не заполнена</p>
        ) : (
          <EconomyTab economy={info.economy} />
        )}
      </div>
    </aside>
  );
}

export { CountrySheet, type TCountrySheetRegistry };
