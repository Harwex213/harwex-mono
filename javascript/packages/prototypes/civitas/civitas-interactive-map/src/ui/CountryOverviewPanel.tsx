import { useSignals } from "@preact/signals-react/runtime";
import { EditableText } from "./EditableText";
import { EditableTextArea } from "./EditableTextArea";
import { FLAG_MAX_EDGE } from "../state/image";
import { ImageUpload } from "./ImageUpload";
import { LORE_MAX, NAME_MAX, SLOGAN_MAX } from "../state/schema";
import { Panel } from "./Panel";
import { selectedCountry } from "../state/selection-store";
import { updateCountry } from "../state/world-store";
import styles from "./panel-bodies.module.css";

// A PHASE-3 PLACEHOLDER. T09 owns the real country overview and will rearrange
// this layout.
//
// The four fields are here because "the editable-field components round-trip
// through the T05 store" cannot be demonstrated otherwise: each one reads the
// selected country and writes it back through `updateCountry`.
//
// Every field carries a `key` containing the country id. Switching the selection
// then remounts the field and drops any pending draft, so a draft for one
// country can never be committed into another.

function CountryOverviewPanel() {
  useSignals();

  const country = selectedCountry.value;

  if (country === null) {
    return (
      <Panel panelId="country" title="Country">
        <p className={styles.empty}>
          no country selected — right-click a province on the map, or pick one from the
          country list
        </p>
      </Panel>
    );
  }

  return (
    <Panel panelId="country" subtitle={"country " + country.id} title="Country">
      <ImageUpload
        key={"flag-" + country.id}
        label="Flag"
        maxEdge={FLAG_MAX_EDGE}
        value={country.flagDataUrl}
        onCommit={(url) => {
          updateCountry(country.id, { flagDataUrl: url });
        }}
      />
      <EditableText
        key={"name-" + country.id}
        label="Name"
        maxLength={NAME_MAX}
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
        rows={8}
        value={country.lore}
        onCommit={(value) => {
          updateCountry(country.id, { lore: value });
        }}
      />
      <p className={styles.note}>T09 fills in the rest of this panel.</p>
    </Panel>
  );
}

export { CountryOverviewPanel };
