import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { countryDisplayName } from "../../../domain/index";
import { provinceDisplayName, useStore } from "../../../store/index";
import styles from "./country-plaque.module.css";

// The plaque is the name tablet at the top centre of the screen, like the title
// cartouche of a political map. It shows the selected country (flag, name, slogan,
// province count) or, with no country, the selected province.
// Not interactive: it is a readout, not a control.
function CountryPlaque() {
  useSignals();
  const store = useStore();

  // The failed URL, not a boolean, so the fallback resets when the selection moves.
  const [brokenFlag, setBrokenFlag] = useState<string | null>(null);

  const scope = store.selection.scope.value;
  const country = store.selection.selectedCountry.value;
  const provinceId = store.selection.selectedProvinceId.value;

  if (country === null && provinceId !== null) {
    const name = provinceDisplayName(store, provinceId);
    return (
      <section className={styles.plaque} aria-label="selected country" data-scope="province">
        <div className={styles.body}>
          <p className={styles.name} title={name}>
            {name}
          </p>
          <p className={styles.hint}>
            unassigned — right-click to select a country
          </p>
        </div>
      </section>
    );
  }

  if (country === null) {
    return (
      <section className={styles.plaque} aria-label="selected country" data-scope="none">
        <div className={styles.body}>
          <p className={styles.nameEmpty}>no selection</p>
          <p className={styles.hint}>left-click a province · right-click for its country</p>
        </div>
      </section>
    );
  }

  const flag = country.flagDataUrl;
  const showFlag = flag !== null && flag !== "" && flag !== brokenFlag;
  // An empty name falls back to the same string as the panel and the map label.
  const shownName = countryDisplayName(country.id, country.name);
  const aggregate = store.labels.aggregates.value.get(country.id);
  const count = aggregate ? aggregate.provinceCount : country.provinceIds.length;
  const subline =
    (provinceId === null ? "" : provinceDisplayName(store, provinceId) + " · ") +
    count +
    (count === 1 ? " province" : " provinces");

  return (
    <section className={styles.plaque} aria-label="selected country" data-scope={scope}>
      {/* The country colour always fills the box. It letterboxes an odd-ratio flag
          and doubles as the no-flag state, so no second layout is needed. */}
      <div className={styles.flag} style={{ background: country.colorHex }}>
        {showFlag ? (
          <img
            className={styles.flagImage}
            alt=""
            src={flag}
            onError={() => {
              setBrokenFlag(flag);
            }}
          />
        ) : null}
      </div>
      <div className={styles.body}>
        <p className={styles.name} title={shownName}>
          {shownName}
        </p>
        {country.slogan === "" ? null : (
          <p className={styles.slogan} title={country.slogan}>
            {"“" + country.slogan + "”"}
          </p>
        )}
        <p className={styles.subline}>{subline}</p>
      </div>
    </section>
  );
}

export { CountryPlaque };
