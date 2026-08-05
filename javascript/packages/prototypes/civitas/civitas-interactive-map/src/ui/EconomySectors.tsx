import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { BASE_SECTOR_KEYS, ECONOMY_CONSTANTS, OTHER_SECTOR_KEYS, SECTOR_LABELS } from "../economy/constants";
import { NumberField, TextField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import { addOtherSector, judgeMode, removeOtherSector, updateSector } from "../state/economy-store";
import { canAddOtherSector } from "./economics-fields";
import {
  formatObor,
  formatPct,
  formatPp,
  formatShare,
  formatSigned,
} from "./economics-format";
import type { SectionProps } from "./EconomyField";
import type { NumberSpec } from "./economics-fields";
import type { SectorDerived, SectorKey } from "../economy/types";
import styles from "./economics.module.css";

// Spec areas 1 and 2: GDP as the sum of five base sectors plus up to two custom
// ones, and growth per sector and overall.
//
// A sector volume is [V]: only a verdict moves it directly, because the engine
// moves it every turn through growth. Both growth columns are [V] too. The [A]
// cells come from `derived.sectors`, matched by key — never recomputed here.

const OBOR_SPEC: NumberSpec = { min: 0, max: 1e15, decimals: 0, integer: false };
const GROWTH_SPEC: NumberSpec = { min: -100, max: 100, decimals: 2, integer: false };

function derivedFor(sectors: readonly SectorDerived[], key: SectorKey): SectorDerived | null {
  for (const sector of sectors) {
    if (sector.key === key) {
      return sector;
    }
  }
  return null;
}

function EconomySectors(props: SectionProps) {
  useSignals();

  const judge = judgeMode.value;
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  const [otherName, setOtherName] = useState("");
  const [otherGrounds, setOtherGrounds] = useState("");
  const [armedRemoval, setArmedRemoval] = useState<SectorKey | null>(null);

  const canAdd = canAddOtherSector(state.sectors);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>GDP and growth</h3>
      <p className={styles.sectionSub}>areas 1 and 2 — sectors, shares, per-sector and overall growth</p>

      <div className={styles.grid}>
        <Readout label="GDP" value={formatObor(derived.gdpTotalObor)} />
        <Readout label="GDP next turn" value={formatObor(derived.gdpNextTotalObor)} />
        <Readout
          label="GDP change"
          tone={derived.gdpChangeObor < 0 ? "bad" : "good"}
          value={formatSigned(formatObor(derived.gdpChangeObor), derived.gdpChangeObor)}
        />
        <Readout
          label="overall growth"
          tone={derived.overallGrowthPct < 0 ? "bad" : "normal"}
          value={formatSigned(formatPct(derived.overallGrowthPct), derived.overallGrowthPct)}
        />
        <Readout
          hint="last turn's rate, used where a formula would otherwise depend on this turn's own growth"
          label="planned growth"
          value={formatPct(derived.plannedGrowthPct)}
        />
        {/* A modifier is measured in percentage POINTS added to every sector's
            own rate, not in percent. */}
        <Readout
          hint="added to every sector's own rate"
          label="growth modifier"
          tone={derived.modifierPp < 0 ? "bad" : "normal"}
          value={formatSigned(formatPp(derived.modifierPp), derived.modifierPp)}
        />
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">sector</th>
              <th scope="col">volume (obor) [V]</th>
              <th scope="col">share</th>
              <th scope="col">permanent [V]</th>
              <th scope="col">temporary [V]</th>
              <th scope="col">shortage</th>
              <th scope="col">pre-shortage</th>
              <th scope="col">final growth</th>
              <th scope="col">volume next</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {state.sectors.map((sector) => {
              const row = derivedFor(derived.sectors, sector.key);
              const isOther = OTHER_SECTOR_KEYS.includes(sector.key);
              const armed = armedRemoval === sector.key;
              return (
                <tr key={sector.key}>
                  <td>
                    {isOther ? (
                      <TextField
                        key={"sector-name-" + sector.key + "-" + countryId}
                        label={SECTOR_LABELS[sector.key]}
                        maxLength={ECONOMY_CONSTANTS.SECTOR_NAME_MAX}
                        tag="P"
                        value={sector.name}
                        onCommit={(next) => {
                          updateSector(countryId, sector.key, { name: next });
                        }}
                      />
                    ) : (
                      sector.name
                    )}
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"sector-gdp-" + sector.key + "-" + countryId}
                      error={errorFor(derived, "sectors." + sector.key + ".gdpObor")}
                      label="volume"
                      spec={OBOR_SPEC}
                      tag="V"
                      value={sector.gdpObor}
                      onCommit={(next) => {
                        updateSector(countryId, sector.key, { gdpObor: next });
                      }}
                    />
                  </td>
                  <td>{formatShare(row?.share ?? 0)}</td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"sector-perm-" + sector.key + "-" + countryId}
                      label="permanent"
                      spec={GROWTH_SPEC}
                      suffix="%"
                      tag="V"
                      value={sector.growthPermanentPct}
                      onCommit={(next) => {
                        updateSector(countryId, sector.key, { growthPermanentPct: next });
                      }}
                    />
                  </td>
                  <td className={styles.cellInput}>
                    <NumberField
                      key={"sector-temp-" + sector.key + "-" + countryId}
                      hint="cleared at turn end"
                      label="temporary"
                      spec={GROWTH_SPEC}
                      suffix="%"
                      tag="V"
                      value={sector.growthTemporaryPct}
                      onCommit={(next) => {
                        updateSector(countryId, sector.key, { growthTemporaryPct: next });
                      }}
                    />
                  </td>
                  <td className={(row?.shortagePenalty ?? 0) > 0 ? styles.cellBad : styles.cellMuted}>
                    {formatShare(row?.shortagePenalty ?? 0)}
                  </td>
                  <td>{formatPct(row?.preShortagePct ?? 0)}</td>
                  <td className={(row?.finalPct ?? 0) < 0 ? styles.cellBad : undefined}>
                    {formatPct(row?.finalPct ?? 0)}
                  </td>
                  <td>{formatObor(row?.gdpNextObor ?? 0)}</td>
                  <td>
                    {isOther ? (
                      <button
                        className={armed ? styles.iconButton + " " + styles.buttonArmed : styles.iconButton}
                        disabled={!judge}
                        title={judge
                          ? "remove this sector — its volume is lost"
                          : "removing a sector is a verdict; turn on judge mode"}
                        type="button"
                        onClick={() => {
                          // An Other sector carries GDP, so a single press must
                          // not delete it.
                          if (!armed) {
                            setArmedRemoval(sector.key);
                            return;
                          }
                          setArmedRemoval(null);
                          removeOtherSector(countryId, sector.key);
                        }}
                      >
                        {armed ? "confirm" : "remove"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>
        a shortage caps a sector&apos;s growth at 0 and can never on its own drive it negative, so a
        0.00% row is a starved sector and not an error. the five base sectors are{" "}
        {BASE_SECTOR_KEYS.length} and always present.
      </p>

      <div className={styles.gridWide}>
        <TextField
          key={"other-name-" + countryId}
          hint="a name for a new Other sector"
          label="new sector name"
          maxLength={ECONOMY_CONSTANTS.SECTOR_NAME_MAX}
          tag="V"
          value={otherName}
          onCommit={setOtherName}
        />
        <TextField
          key={"other-grounds-" + countryId}
          hint={"weighty grounds, required — the sector does not exist without them (max "
            + ECONOMY_CONSTANTS.SECTOR_GROUNDS_MAX + " characters)"}
          label="grounds"
          maxLength={ECONOMY_CONSTANTS.SECTOR_GROUNDS_MAX}
          tag="V"
          value={otherGrounds}
          onCommit={setOtherGrounds}
        />
      </div>
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={!judge || !canAdd || otherGrounds.trim() === ""}
          title={canAdd
            ? "add an Other sector"
            : "both Other slots are taken (" + ECONOMY_CONSTANTS.OTHER_SECTOR_MAX + " maximum)"}
          type="button"
          onClick={() => {
            addOtherSector(countryId, otherName, otherGrounds);
            setOtherName("");
            setOtherGrounds("");
          }}
        >
          add sector
        </button>
      </div>

      {state.sectors.some((sector) => {
        return OTHER_SECTOR_KEYS.includes(sector.key);
      }) ? (
        <ul className={styles.list}>
          {state.sectors.filter((sector) => {
            return OTHER_SECTOR_KEYS.includes(sector.key);
          }).map((sector) => {
            return (
              <li className={styles.listRow} key={"grounds-" + sector.key}>
                <span>
                  {sector.name} — grounds: {sector.grounds ?? "(none — this raises V10)"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export { EconomySectors };
