import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { countryAggregates } from "../state/country-store";
import { countryDisplayName } from "../state/schema";
import { provinceDisplayName } from "../state/world-store";
import {
  selectedCountry,
  selectedProvinceId,
  selectionScope,
} from "../state/selection-store";
import styles from "./country-plaque.module.css";

// The top plaque: the selected country's flag, name and slogan, in the register
// of a political-map legend.
//
// NOT INTERACTIVE. Nesting a button around a block that contains an image
// invites a nested-interactive accessibility problem for no gain; the button bar
// sits one row below it.

function CountryPlaque() {
  useSignals();

  // The failed URL, not a boolean. A boolean would keep the fallback showing
  // after the selection moved to a country whose flag is fine.
  const [brokenFlag, setBrokenFlag] = useState<string | null>(null);

  const scope = selectionScope.value;
  const country = selectedCountry.value;
  const provinceId = selectedProvinceId.value;

  if (country === null && provinceId !== null) {
    const name = provinceDisplayName(provinceId);
    return (
      <section className={styles.plaque} aria-label="selected country" data-scope="province">
        <div className={styles.body}>
          <p className={styles.name} title={name}>
            {name}
          </p>
          <p className={styles.hint}>
            unassigned — right-click to select a country, or paint it in assign mode
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
  // An emptied name must not render a blank gold plaque. The panel and the map
  // label fall back to the same string.
  const shownName = countryDisplayName(country.id, country.name);
  const aggregate = countryAggregates.value.get(country.id);
  const count = aggregate ? aggregate.provinceCount : country.provinceIds.length;
  const subline =
    (provinceId === null ? "" : provinceDisplayName(provinceId) + " · ") +
    count +
    (count === 1 ? " province" : " provinces");

  return (
    <section className={styles.plaque} aria-label="selected country" data-scope={scope}>
      {/* The country's colour is ALWAYS behind the box: it letterboxes a
          contained flag whose ratio is not 3:2, and the no-flag state — no flag
          at all, or `onError` on a corrupt stored data URL — is then the same
          element with nothing in it rather than a second visual treatment. */}
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
