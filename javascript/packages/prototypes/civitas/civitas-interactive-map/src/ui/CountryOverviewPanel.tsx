import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { EditableText } from "./EditableText";
import { EditableTextArea } from "./EditableTextArea";
import { FLAG_MAX_EDGE, dataUrlBytes } from "../state/image";
import { ImageUpload } from "./ImageUpload";
import { LORE_MAX, NAME_MAX, SLOGAN_MAX, countryDisplayName } from "../state/schema";
import { Panel } from "./Panel";
import { countryAggregates } from "../state/country-store";
import {
  formatArea,
  formatBytes,
  formatProvinceCount,
  loreCounterText,
  saveNoticeFor,
} from "./country-overview";
import { countryById, flushState, stateWarning, updateCountry } from "../state/world-store";
import { selectedCountry } from "../state/selection-store";
import type { SaveNotice } from "./country-overview";
import styles from "./country-overview.module.css";

// The country's identity sheet: flag, name, slogan, lore, and the two territory
// facts T06's aggregates already carry. Every field writes through
// `updateCountry`, which is the only writer, and the store debounces the actual
// `localStorage` write behind it.
//
// Every field carries a `key` containing the country id. Switching the selection
// then remounts the field and drops any pending draft, so a draft for one
// country can never be committed into another.

// The flag message belongs to the country it was produced for. The panel itself
// does NOT remount when the selection moves — only its keyed children do — so
// the tag is what stops a message for country 3 surviving into country 4.
type FlagState = {
  countryId: number;
  touched: boolean;
  rejected: boolean;
};

const FLAG_HINT =
  "png, jpeg, webp or svg · scaled to " + FLAG_MAX_EDGE + "px on its long edge before it is saved";

function CountryOverviewPanel() {
  useSignals();

  const [flagState, setFlagState] = useState<FlagState | null>(null);

  const country = selectedCountry.value;
  const warning = stateWarning.value;
  const aggregates = countryAggregates.value;

  if (country === null) {
    return (
      <Panel panelId="country" title="Country">
        <p className={styles.empty}>
          no country selected — right-click a province on the map, or click a row in the
          country list on the left
        </p>
      </Panel>
    );
  }

  // Derived, not reset in an effect: a message tagged with another country's id
  // is simply not this country's message.
  const flag = flagState !== null && flagState.countryId === country.id ? flagState : null;

  function onFlag(dataUrl: string | null): void {
    if (country === null) {
      return;
    }
    updateCountry(country.id, { flagDataUrl: dataUrl });
    // `updateCountry` REJECTS SILENTLY: a data URL over `IMAGE_DATA_URL_MAX`
    // fails `isImageDataUrl` and the patch is dropped with no return value and
    // no warning. Reading the store back is the only way to know. `.peek()`, not
    // `.value` — this is an event handler and must not subscribe.
    const stored = countryById.peek().get(country.id)?.flagDataUrl ?? null;
    const rejected = dataUrl !== null && stored !== dataUrl;
    // Resolves the quota outcome NOW instead of 400 ms later, which would read
    // as "it worked, then a banner appeared". Only on a flag write or removal;
    // keystrokes stay on the debounce.
    flushState();
    setFlagState({ countryId: country.id, touched: dataUrl !== null, rejected });
  }

  const aggregate = aggregates.get(country.id);
  const provinceCount = aggregate ? aggregate.provinceCount : country.provinceIds.length;
  const pixelCount = aggregate ? aggregate.pixelCount : 0;
  const flagBytes = country.flagDataUrl === null ? 0 : dataUrlBytes(country.flagDataUrl);

  const rejectedNotice: SaveNotice = {
    kind: "error",
    text: "that image is still too large to store after downscaling; try a smaller file",
  };
  const notice =
    flag !== null && flag.rejected
      ? rejectedNotice
      : saveNoticeFor(warning, flag !== null && flag.touched);

  // The COMMITTED value, not the draft, so it moves on the same 200 ms window as
  // everything else. It exists to warn near the cap, not to count keystrokes.
  const counter = loreCounterText(country.lore.length, LORE_MAX);

  return (
    <Panel panelId="country" subtitle={"country " + country.id} title="Country">
      {notice === null ? null : (
        <p className={styles.notice} data-kind={notice.kind}>
          {notice.text}
        </p>
      )}

      <ImageUpload
        key={"flag-" + country.id}
        hint={FLAG_HINT}
        label="Flag"
        maxEdge={FLAG_MAX_EDGE}
        previewClassName={styles.flagPreview}
        replaceLabel="replace…"
        value={country.flagDataUrl}
        onCommit={onFlag}
      />

      <EditableText
        key={"name-" + country.id}
        label="Name"
        maxLength={NAME_MAX}
        // An emptied field shows the fallback greyed, and the plaque and the map
        // label show the same string for real.
        placeholder={countryDisplayName(country.id, "")}
        value={country.name}
        onCommit={(value) => {
          updateCountry(country.id, { name: value });
        }}
      />

      <EditableText
        key={"slogan-" + country.id}
        label="Slogan"
        maxLength={SLOGAN_MAX}
        placeholder="ever onward"
        value={country.slogan}
        onCommit={(value) => {
          updateCountry(country.id, { slogan: value });
        }}
      />

      <EditableTextArea
        key={"lore-" + country.id}
        label="Lore"
        maxLength={LORE_MAX}
        placeholder="how the country came to be, who rules it, and what it wants"
        rows={12}
        value={country.lore}
        onCommit={(value) => {
          updateCountry(country.id, { lore: value });
        }}
      />
      {counter === null ? null : <p className={styles.counter}>{counter}</p>}

      {/* Read-only. A `<dl>` may only contain `dt`, `dd` and `div`, so the
          heading sits outside it. */}
      <section className={styles.facts}>
        <p className={styles.factsTitle}>Territory</p>
        <dl className={styles.factList}>
          <div className={styles.fact}>
            <dt className={styles.factTerm}>provinces</dt>
            <dd className={styles.factValue}>{formatProvinceCount(provinceCount)}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factTerm}>area</dt>
            <dd className={styles.factValue}>{formatArea(pixelCount)}</dd>
          </div>
          {country.flagDataUrl === null ? null : (
            <div className={styles.fact}>
              <dt className={styles.factTerm}>flag</dt>
              <dd className={styles.factValue}>{formatBytes(flagBytes)}</dd>
            </div>
          )}
        </dl>
      </section>
    </Panel>
  );
}

export { CountryOverviewPanel };
