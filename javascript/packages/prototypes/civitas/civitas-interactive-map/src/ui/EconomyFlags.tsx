import { CONCESSION_REGIONS, ECONOMY_CONSTANTS, REGIONS, SECTOR_LABELS } from "../economy/constants";
import { NumberField, SelectField, ToggleField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import { formatBool, formatFactor, formatInteger, formatObor, formatPp, formatSigned, formatTurns } from "./economics-format";
import { updateEconomy } from "../state/economy-store";
import type { ActionKind, EnterpriseKind, Region, SectorKey } from "../economy/types";
import type { NumberSpec } from "./economics-fields";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec area 12: the state flags — mobilization, region, nationalization and
// privatization, concessions, the cooldowns and the timed modifiers.
//
// The roll is an INPUT and is never generated here. Spec 16.3 is explicit: no
// `Math.random` anywhere in this app. A judge types the number after a roll in
// chat.

const ROLL_SPEC: NumberSpec = {
  min: ECONOMY_CONSTANTS.ROLL_MIN,
  max: ECONOMY_CONSTANTS.ROLL_MAX,
  decimals: 0,
  integer: true,
};

type ActionOption = "none" | ActionKind;

const REGION_LABELS: Readonly<Record<Region, string>> = {
  none: "none",
  bengo: "Bengo",
  aglan: "Aglan",
  sudhara: "Sudhara",
  badiyat: "Badiyat",
};

const ENTERPRISE_OPTIONS: readonly { value: EnterpriseKind; label: string }[] = [
  { value: "civilian", label: "civilian" },
  { value: "military", label: "military" },
];

function EconomyFlags(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  const pending = state.pendingAction;
  const kind: ActionOption = pending === null ? "none" : pending.kind;
  const concessionAllowed = CONCESSION_REGIONS.includes(state.region);

  // An unavailable action is refused at the select rather than accepted and then
  // rejected by the turn, so V8 is unreachable by clicking.
  const actionOptions: readonly { value: ActionOption; label: string }[] = [
    { value: "none", label: "none" },
    {
      value: "nationalization",
      label: derived.nationalizationAvailable
        ? "nationalization"
        : "nationalization (unavailable)",
    },
    {
      value: "privatization",
      label: derived.privatizationAvailable ? "privatization" : "privatization (unavailable)",
    },
  ];

  const actionReason = (() => {
    const parts: string[] = [];
    if (!derived.nationalizationAvailable) {
      parts.push(
        state.turnsSinceNationalization < ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS
          ? "nationalization is on cooldown ("
            + formatTurns(ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS - state.turnsSinceNationalization)
            + " to go)"
          : "nationalization is locked out at band " + derived.controlBandIndex,
      );
    }
    if (!derived.privatizationAvailable) {
      parts.push(
        state.turnsSincePrivatization < ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS
          ? "privatization is on cooldown ("
            + formatTurns(ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS - state.turnsSincePrivatization)
            + " to go)"
          : "privatization is locked out at band " + derived.controlBandIndex,
      );
    }
    return parts.length === 0 ? null : parts.join("; ");
  })();

  const concessionOptions: readonly { value: string; label: string }[] = [
    { value: "none", label: "none" },
    ...state.sectors.map((sector) => {
      return { value: sector.key, label: sector.name || SECTOR_LABELS[sector.key] };
    }),
  ];

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>States and flags</h3>
      <p className={styles.sectionSub}>area 12 — mobilization, region, actions, concessions, cooldowns</p>

      <p className={styles.subhead}>mobilization</p>
      <div className={styles.grid}>
        <ToggleField
          key={"mobilized-" + countryId}
          label="mobilized"
          tag="V"
          value={state.mobilized}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, mobilized: next };
            });
          }}
        />
        <ToggleField
          key={"mob-justified-" + countryId}
          hint="an unjustified mobilization costs rating every turn"
          label="justified"
          tag="V"
          value={state.mobilizationJustified}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, mobilizationJustified: next };
            });
          }}
        />
        <Readout
          hint={"mobilization adds " + formatPp(ECONOMY_CONSTANTS.MOB_STEP_BONUS_PP) + " to it"}
          label="military step"
          value={formatPp(derived.militaryStepLimitPp)}
        />
        <Readout label="FR regime multiplier" value={formatFactor(derived.frRegimeMultiplier)} />
        <Readout label="MIC regime multiplier" value={formatFactor(derived.micRegimeMultiplier)} />
        <Readout
          label="mobilization growth"
          tone={derived.mobilizationGrowthPp < 0 ? "bad" : "normal"}
          value={formatSigned(formatPp(derived.mobilizationGrowthPp), derived.mobilizationGrowthPp)}
        />
      </div>
      {state.mobilized && !state.mobilizationJustified ? (
        <p className={styles.note} data-kind="error">
          an unjustified mobilization costs {ECONOMY_CONSTANTS.MOB_UNJUSTIFIED_RATING_PER_TURN} rating
          points every turn it stands.
        </p>
      ) : null}

      <p className={styles.subhead}>region</p>
      <div className={styles.grid}>
        <SelectField
          key={"region-" + countryId}
          hint="only Bengo, Aglan, Sudhara and Badiyat may grant a concession"
          label="region"
          options={REGIONS.map((region) => {
            return { value: region, label: REGION_LABELS[region] };
          })}
          tag="V"
          value={state.region}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, region: next };
            });
          }}
        />
      </div>

      <p className={styles.subhead}>nationalization and privatization</p>
      <div className={styles.gridWide}>
        <SelectField
          key={"action-kind-" + countryId}
          error={errorFor(derived, "pendingAction")}
          hint={actionReason ?? "resolved at End Turn"}
          label="pending action"
          options={actionOptions}
          tag="P"
          value={kind}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              if (next === "none") {
                return { ...current, pendingAction: null };
              }
              // An unavailable action is not written at all.
              const available = next === "nationalization"
                ? derived.nationalizationAvailable
                : derived.privatizationAvailable;
              if (!available) {
                return current;
              }
              return {
                ...current,
                pendingAction: {
                  kind: next,
                  enterprise: current.pendingAction?.enterprise ?? "civilian",
                  roll: current.pendingAction?.roll ?? ECONOMY_CONSTANTS.ROLL_MIN,
                },
              };
            });
          }}
        />
        <SelectField
          key={"action-enterprise-" + countryId}
          blocked={pending === null ? "no action pending" : null}
          label="enterprise"
          options={ENTERPRISE_OPTIONS}
          tag="P"
          value={pending?.enterprise ?? "civilian"}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              if (current.pendingAction === null) {
                return current;
              }
              return { ...current, pendingAction: { ...current.pendingAction, enterprise: next } };
            });
          }}
        />
        <NumberField
          key={"action-roll-" + countryId}
          blocked={pending === null ? "no action pending" : null}
          error={errorFor(derived, "pendingAction.roll")}
          hint={"a d10 typed after the roll — privatization succeeds on "
            + ECONOMY_CONSTANTS.PRIV_SUCCESS_MIN_ROLL + "+"}
          label="roll (d10)"
          spec={ROLL_SPEC}
          tag="V"
          value={pending?.roll ?? ECONOMY_CONSTANTS.ROLL_MIN}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              if (current.pendingAction === null) {
                return current;
              }
              return { ...current, pendingAction: { ...current.pendingAction, roll: next } };
            });
          }}
        />
      </div>
      <div className={styles.grid}>
        <Readout label="nationalization available" value={formatBool(derived.nationalizationAvailable)} />
        <Readout label="privatization available" value={formatBool(derived.privatizationAvailable)} />
        <Readout label="turns since nationalization" value={formatInteger(state.turnsSinceNationalization)} />
        <Readout label="turns since privatization" value={formatInteger(state.turnsSincePrivatization)} />
        <Readout label="nationalization FR payout" value={formatObor(derived.natFrPayout)} />
        <Readout label="nationalization MIC payout" value={formatObor(derived.natMicPayout)} />
        <Readout
          hint={"a privatization drag holds FR at "
            + formatFactor(1 - ECONOMY_CONSTANTS.PRIV_DRAG_PCT / 100)}
          label="privatization FR drag"
          value={formatTurns(state.privatizationFrDragTurns)}
        />
        <Readout label="privatization MIC drag" value={formatTurns(state.privatizationMicDragTurns)} />
      </div>

      <p className={styles.subhead}>concessions</p>
      <div className={styles.gridWide}>
        <SelectField
          key={"concession-" + countryId}
          blocked={concessionAllowed
            ? null
            : "a concession needs a region of Bengo, Aglan, Sudhara or Badiyat"}
          error={errorFor(derived, "pendingConcession")}
          hint={"grants " + formatPp(ECONOMY_CONSTANTS.CONCESSION_GROWTH_PP)
            + " to every sector and costs total GDP divided by the province count"}
          label="grant a concession in"
          options={concessionOptions}
          tag="V"
          value={state.pendingConcession?.sectorKey ?? "none"}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              if (next === "none") {
                return { ...current, pendingConcession: null };
              }
              return { ...current, pendingConcession: { sectorKey: next as SectorKey } };
            });
          }}
        />
        <Readout
          label="concession growth"
          value={formatSigned(formatPp(derived.concessionGrowthPp), derived.concessionGrowthPp)}
        />
        <Readout
          hint="total GDP divided by the province count — paint provinces and the cost falls"
          label="concession cost"
          value={formatObor(derived.concessionCostObor)}
        />
      </div>

      {state.concessions.length === 0 ? (
        <p className={styles.note}>no concessions granted.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">concession</th>
                <th scope="col">sector</th>
                <th scope="col">GDP transferred</th>
                <th scope="col">granted</th>
                <th scope="col">active [V]</th>
              </tr>
            </thead>
            <tbody>
              {state.concessions.map((concession) => {
                return (
                  <tr key={concession.id}>
                    <td>#{concession.id}</td>
                    <td>{SECTOR_LABELS[concession.sectorKey]}</td>
                    <td>{formatObor(concession.gdpTransferredObor)}</td>
                    <td>turn {formatInteger(concession.grantedTurn)}</td>
                    <td className={styles.cellInput}>
                      <ToggleField
                        key={"concession-active-" + concession.id + "-" + countryId}
                        label="active"
                        tag="V"
                        value={concession.active}
                        onCommit={(next) => {
                          updateEconomy(countryId, (current) => {
                            return {
                              ...current,
                              concessions: current.concessions.map((entry) => {
                                return entry.id === concession.id
                                  ? { ...entry, active: next }
                                  : entry;
                              }),
                            };
                          });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.subhead}>timed modifiers</p>
      {state.timedModifiers.length === 0 ? (
        <p className={styles.note}>none in force.</p>
      ) : (
        <ul className={styles.list}>
          {state.timedModifiers.map((modifier) => {
            return (
              <li className={styles.listRow} key={modifier.id}>
                <span>{modifier.reason}</span>
                <span className={styles.listValue}>
                  {formatSigned(formatPp(modifier.growthPp), modifier.growthPp)} ·{" "}
                  {formatTurns(modifier.turnsRemaining)} left
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.grid}>
        <Readout
          label="timed modifier total"
          value={formatSigned(formatPp(derived.timedModifierPp), derived.timedModifierPp)}
        />
      </div>

      <p className={styles.note}>
        a cooldown is {ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS} turns and is tracked per action.
        nationalization is locked out at band {ECONOMY_CONSTANTS.NAT_LOCK_BAND_INDEX} and
        privatization at band {ECONOMY_CONSTANTS.PRIV_LOCK_BAND_INDEX}. a roll is typed, never
        generated: there is no dice engine in this app.
      </p>
    </section>
  );
}

export { EconomyFlags };
