import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { PROVINCE_IMAGE_MAX_EDGE } from "../state/image";
import { PROVINCE_IMAGE_STORE_BYTES, budgetText, imageSaveNoticeFor, imagesRemaining } from "./province-list";
import { Panel } from "./Panel";
import { ProvinceList } from "./ProvinceList";
import { STORAGE_BUDGET_BYTES } from "../state/persistence";
import { stateBytes, stateWarning } from "../state/world-store";
import { selectedCountry } from "../state/selection-store";
import type { ImageNotice, OverrideSummary } from "./province-list";
import type { SaveNotice } from "./country-overview";
import styles from "./province-list.module.css";

// The selected country's provinces, one editable row each: image, name, lore.
// Every write goes through T05's three province setters, which are already
// sparse — a province the user never touched is never written.
//
// The list is keyed by the country id. That is what resets the search query and
// the scroll position when the selection moves, with no effect and no cleanup.

const IMAGE_NOTE =
  "png, jpeg, webp or svg · scaled to " +
  PROVINCE_IMAGE_MAX_EDGE +
  "px on its long edge before it is saved";

function ProvincesOverviewPanel() {
  useSignals();

  const [notice, setNotice] = useState<ImageNotice | null>(null);

  const country = selectedCountry.value;
  const warning = stateWarning.value;
  const used = stateBytes.value;

  if (country === null) {
    return (
      <Panel panelId="provinces" title="Provinces">
        <p className={styles.empty}>
          no country selected — right-click a province on the map to select its country
        </p>
      </Panel>
    );
  }

  const total = country.provinceIds.length;

  if (total === 0) {
    return (
      <Panel
        panelId="provinces"
        subtitle={country.name + " · 0 provinces"}
        title="Provinces"
      >
        <p className={styles.empty}>
          this country holds no provinces — turn on assign mode and paint some
        </p>
      </Panel>
    );
  }

  // The message is TAGGED and DERIVED, not reset in an effect: the panel itself
  // does not remount when the selection moves, only its keyed child does, so a
  // notice produced for a province of another country is simply not this
  // country's message.
  const mine =
    notice !== null && country.provinceIds.includes(notice.provinceId) ? notice : null;

  const rejectedNotice: SaveNotice = {
    kind: "error",
    text: "that image is still too large to store after downscaling; try a smaller file",
  };
  const saveNotice =
    mine !== null && mine.rejected
      ? rejectedNotice
      : imageSaveNoticeFor(warning, mine !== null && mine.touched);

  const remaining = imagesRemaining(used, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES);

  function footer(shown: number, summary: OverrideSummary) {
    return (
      <p className={styles.note}>
        {shown} of {total} shown · {summary.edited} edited ·{" "}
        {budgetText(summary.withImage, remaining)}
        <br />
        {IMAGE_NOTE}
      </p>
    );
  }

  return (
    <Panel
      panelId="provinces"
      subtitle={country.name + " · " + total + " provinces"}
      title="Provinces"
    >
      {/* Panel level, never inside a row: a quota failure caused by lore must
          not appear under one province's file picker. */}
      {saveNotice === null ? null : (
        <p className={styles.notice} data-kind={saveNotice.kind}>
          {saveNotice.text}
        </p>
      )}

      <ProvinceList
        key={country.id}
        footer={footer}
        provinceIds={country.provinceIds}
        onImageNotice={setNotice}
      />
    </Panel>
  );
}

export { IMAGE_NOTE, ProvincesOverviewPanel };
