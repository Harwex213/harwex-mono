import {
  ECONOMY_CONSTANTS,
  RESOURCE_CATEGORY,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  SECTOR_DEPENDENCIES,
  SECTOR_LABELS,
} from "../economy/constants";
import { NumberField, errorFor } from "./EconomyField";
import { formatInteger, formatObor, formatShare } from "./economics-format";
import { updateResource } from "../state/economy-store";
import type { NumberSpec } from "./economics-fields";
import type { ResourceCategory, ResourceDerived, ResourceKey } from "../economy/types";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec area 10: the eight resources, their extraction, their consumption and
// their shortage.
//
// A fresh country starts with ZERO deposits, so every resource-dependent sector
// reads 0.00% growth until a judge sets a geology. That is correct and not a bug,
// which is why the footer says so — otherwise it gets filed as one.

const UNITS_SPEC: NumberSpec = { min: 0, max: 1e9, decimals: 0, integer: true };
const DEPOSITS_SPEC: NumberSpec = { min: 0, max: 100000, decimals: 0, integer: true };
const BONUS_SPEC: NumberSpec = { min: 0, max: 1000, decimals: 2, integer: false };
const BLOCKADE_SPEC: NumberSpec = { min: 0, max: 100, decimals: 2, integer: false };

const CATEGORY_TITLES: Readonly<Record<ResourceCategory, string>> = {
  fuel: "fuel",
  raw: "raw materials",
  luxury: "luxury",
};

function derivedFor(resources: readonly ResourceDerived[], key: ResourceKey): ResourceDerived | null {
  for (const resource of resources) {
    if (resource.key === key) {
      return resource;
    }
  }
  return null;
}

function EconomyResources(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  let lastCategory: ResourceCategory | null = null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Resources</h3>
      <p className={styles.sectionSub}>area 10 — extraction, consumption, shortage</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">resource</th>
              <th scope="col">deposits [V]</th>
              <th scope="col">bonus % [V]</th>
              <th scope="col">blockade % [V]</th>
              <th scope="col">imports [P]</th>
              <th scope="col">exports [P]</th>
              <th scope="col">stock</th>
              <th scope="col">need</th>
              <th scope="col">extraction</th>
              <th scope="col">imported</th>
              <th scope="col">exported</th>
              <th scope="col">supply</th>
              <th scope="col">shortage</th>
              <th scope="col">free</th>
              <th scope="col">stock next</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((key) => {
              const resource = state.resources.find((entry) => {
                return entry.key === key;
              });
              if (resource === undefined) {
                return null;
              }
              const row = derivedFor(derived.resources, key);
              const category = RESOURCE_CATEGORY[key];
              const heading = category === lastCategory ? null : category;
              lastCategory = category;
              return [
                heading === null ? null : (
                  <tr className={styles.groupRow} key={"group-" + heading}>
                    <td colSpan={15}>{CATEGORY_TITLES[heading]}</td>
                  </tr>
                ),
                <tr key={key}>
                  <td>{RESOURCE_LABELS[key]}</td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"deposits-" + key + "-" + countryId}
                      error={errorFor(derived, "resources." + key + ".deposits")}
                      label="deposits"
                      spec={DEPOSITS_SPEC}
                      tag="V"
                      value={resource.deposits}
                      onCommit={(next) => {
                        updateResource(countryId, key, { deposits: next });
                      }}
                    />
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"bonus-" + key + "-" + countryId}
                      error={errorFor(derived, "resources." + key + ".extractionBonusPct")}
                      label="bonus"
                      spec={BONUS_SPEC}
                      suffix="%"
                      tag="V"
                      value={resource.extractionBonusPct}
                      onCommit={(next) => {
                        updateResource(countryId, key, { extractionBonusPct: next });
                      }}
                    />
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"blockade-" + key + "-" + countryId}
                      error={errorFor(derived, "resources." + key + ".blockadePct")}
                      label="blockade"
                      spec={BLOCKADE_SPEC}
                      suffix="%"
                      tag="V"
                      value={resource.blockadePct}
                      onCommit={(next) => {
                        updateResource(countryId, key, { blockadePct: next });
                      }}
                    />
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"imports-" + key + "-" + countryId}
                      error={errorFor(derived, "resources." + key + ".importsRequested")}
                      label="imports"
                      spec={UNITS_SPEC}
                      tag="P"
                      value={resource.importsRequested}
                      onCommit={(next) => {
                        updateResource(countryId, key, { importsRequested: next });
                      }}
                    />
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"exports-" + key + "-" + countryId}
                      error={errorFor(derived, "resources." + key + ".exports")}
                      label="exports"
                      spec={UNITS_SPEC}
                      tag="P"
                      value={resource.exports}
                      onCommit={(next) => {
                        updateResource(countryId, key, { exports: next });
                      }}
                    />
                  </td>
                  <td>{formatInteger(resource.stockUnits)}</td>
                  <td>{formatInteger(row?.needUnits ?? 0)}</td>
                  <td>{formatInteger(row?.extractionUnits ?? 0)}</td>
                  <td>{formatInteger(row?.importUnits ?? 0)}</td>
                  <td>{formatInteger(row?.exportsAppliedUnits ?? 0)}</td>
                  <td>{formatInteger(row?.supplyUnits ?? 0)}</td>
                  <td className={(row?.shortage ?? 0) > 0 ? styles.cellBad : styles.cellMuted}>
                    {formatShare(row?.shortage ?? 0)}
                  </td>
                  <td>{formatInteger(row?.freeUnits ?? 0)}</td>
                  <td>{formatInteger(row?.stockNextUnits ?? 0)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>
        one deposit yields {ECONOMY_CONSTANTS.DEPOSIT_YIELD_UNITS} units a turn, and one unit covers{" "}
        {formatObor(ECONOMY_CONSTANTS.OBOR_PER_RESOURCE_UNIT)} obor of dependent output. a fresh
        country has no deposits at all, so every dependent sector reads 0.00% growth until a judge
        sets its geology — that is the opening state, not a fault. a shortage caps a sector at 0 and
        never pushes it below.
      </p>

      <p className={styles.subhead}>which sector needs what</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">sector</th>
              <th scope="col">resources it consumes</th>
            </tr>
          </thead>
          <tbody>
            {state.sectors.map((sector) => {
              const needs = SECTOR_DEPENDENCIES[sector.key];
              return (
                <tr key={"deps-" + sector.key}>
                  <td>{sector.name || SECTOR_LABELS[sector.key]}</td>
                  <td>
                    {needs.length === 0
                      ? "none — an Other sector has no resource dependency"
                      : needs.map((key) => {
                        return RESOURCE_LABELS[key];
                      }).join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export { EconomyResources };
