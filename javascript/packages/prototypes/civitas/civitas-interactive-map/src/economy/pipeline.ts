import { ECONOMY_CONSTANTS } from "./constants";
import { buildTurnRecord, delta, pushTurnRecord } from "./history";
import { deriveEconomy } from "./derive";
import { finiteOr, roundTo } from "./num";
import type {
  EconomyContext,
  EconomyState,
  Loan,
  StepInput,
  StepOutput,
  TurnResolution,
  TurnStep,
  TurnStepRecord,
} from "./types";

// `resolveTurn` — End Turn, spec section 16.2.
//
// THE STEP ORDER IS LOAD-BEARING. A reordering silently changes every number,
// because the FR charges at steps 6, 7, 8 and 9 all draw on one running balance
// (spec 8.4a). `TURN_STEPS` is therefore data, and `pipeline.test.ts` asserts the
// fifteen names deep-equal the spec's list in the spec's order. That is the
// cheapest possible defence of the ordering.
//
// No step mutates anything. Each returns a NEW draft, and `resolveTurn` never
// touches its argument.

const DEFAULT_CONTEXT: EconomyContext = { provinceCount: 0 };

const STEP_NAMES: readonly string[] = [
  "derive-and-validate",
  "resources",
  "generation",
  "actions",
  "borrowing",
  "savings",
  "debt-service",
  "upkeep",
  "spending",
  "auto-invest",
  "growth",
  "gdp",
  "rating",
  "flags",
  "commit",
];

function copyState(state: EconomyState): EconomyState {
  return {
    ...state,
    sectors: state.sectors.map((sector) => {
      return { ...sector };
    }),
    frExpenseLines: state.frExpenseLines.map((line) => {
      return { ...line };
    }),
    micExpenseLines: state.micExpenseLines.map((line) => {
      return { ...line };
    }),
    frIncomeLines: state.frIncomeLines.map((line) => {
      return { ...line };
    }),
    micIncomeLines: state.micIncomeLines.map((line) => {
      return { ...line };
    }),
    resources: state.resources.map((resource) => {
      return { ...resource };
    }),
    loans: state.loans.map((loan) => {
      return { ...loan };
    }),
    concessions: state.concessions.map((concession) => {
      return { ...concession };
    }),
    pendingConcession: state.pendingConcession === null
      ? null
      : { ...state.pendingConcession },
    pendingAction: state.pendingAction === null ? null : { ...state.pendingAction },
    timedModifiers: state.timedModifiers.map((modifier) => {
      return { ...modifier };
    }),
    history: state.history.map((record) => {
      return {
        ...record,
        steps: record.steps.map((step) => {
          return { ...step, deltas: [...step.deltas], notes: [...step.notes] };
        }),
        warnings: [...record.warnings],
      };
    }),
  };
}

function record(step: string, deltas: TurnStepRecord["deltas"], notes: string[]): TurnStepRecord {
  return { step, deltas, notes };
}

const TURN_STEPS: readonly TurnStep[] = [
  {
    name: "derive-and-validate",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft,
        record: record(
          "derive-and-validate",
          [
            delta("gdpTotalObor", derived.gdpTotalObor, "obor"),
            delta("plannedGrowthPct", derived.plannedGrowthPct, "pct"),
            delta("warnings", derived.warnings.length, "count"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "resources",
    run: ({ derived, draft }: StepInput): StepOutput => {
      const deltas = derived.resources
        .filter((resource) => {
          return resource.shortage > 0;
        })
        .map((resource) => {
          return delta(resource.key + " shortage", resource.shortage * 100, "pct");
        });
      let free = 0;
      for (const resource of derived.resources) {
        free += resource.freeUnits;
      }
      deltas.push(delta("free units carried", free, "units"));
      return { draft, record: record("resources", deltas, []) };
    },
  },
  {
    name: "generation",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft,
        record: record(
          "generation",
          [
            delta("frGenerated", derived.frGenerated, "fr"),
            delta("micGenerated", derived.micGenerated, "mic"),
            delta("frCore", derived.frCore, "fr"),
            delta("frEmission", derived.frEmission, "fr"),
            delta("ratingFactor", derived.ratingFactor, "factor"),
            delta("controlFrMultiplier", derived.controlFrMultiplier, "factor"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "actions",
    run: ({ state, derived, draft }: StepInput): StepOutput => {
      const action = derived.action;
      let next = draft;

      if (action.timedModifier !== null) {
        next = {
          ...next,
          timedModifiers: [
            ...next.timedModifiers,
            {
              id: finiteOr(state.nextModifierId, 1),
              reason: action.timedModifier.reason,
              growthPp: action.timedModifier.growthPp,
              turnsRemaining: action.timedModifier.turnsRemaining,
            },
          ],
          nextModifierId: finiteOr(state.nextModifierId, 1) + 1,
        };
      }
      if (action.privatizationFrDragTurns > 0) {
        next = { ...next, privatizationFrDragTurns: action.privatizationFrDragTurns };
      }
      if (action.privatizationMicDragTurns > 0) {
        next = { ...next, privatizationMicDragTurns: action.privatizationMicDragTurns };
      }

      const notes = [...action.notes];
      if (derived.concessionGranted && derived.concessionSectorKey !== null) {
        next = {
          ...next,
          concessions: [
            ...next.concessions,
            {
              id: finiteOr(state.nextConcessionId, 1),
              sectorKey: derived.concessionSectorKey,
              // Written at step 12, where the cost is computed.
              gdpTransferredObor: 0,
              grantedTurn: finiteOr(state.turn, 1),
              active: true,
            },
          ],
          nextConcessionId: finiteOr(state.nextConcessionId, 1) + 1,
        };
        notes.push("concession granted against " + derived.concessionSectorKey);
      }

      return {
        draft: next,
        record: record(
          "actions",
          [
            delta("natFrPayout", derived.natFrPayout, "fr"),
            delta("natMicPayout", derived.natMicPayout, "mic"),
            delta("controlShift", action.controlShift, "count"),
            delta(
              "timedModifierPp",
              action.timedModifier === null ? 0 : action.timedModifier.growthPp,
              "pp",
            ),
          ],
          notes,
        ),
      };
    },
  },
  {
    name: "borrowing",
    run: ({ state, derived, draft }: StepInput): StepOutput => {
      const created = derived.createdLoan;
      const next = created === null
        ? draft
        : {
          ...draft,
          loans: [...draft.loans, { ...created }],
          nextLoanId: finiteOr(state.nextLoanId, 1) + 1,
        };
      const notes = created === null
        ? []
        : [
          "loan " + created.id + " for " + created.principal.toFixed(2) + " FR at "
          + created.ratePct.toFixed(2) + "% over " + created.termTurns
          + " turns; its first payment falls next turn",
        ];
      return {
        draft: next,
        record: record(
          "borrowing",
          [
            delta("debtLimit", derived.debtLimit, "fr"),
            delta("newLoanAvailable", derived.newLoanAvailable, "fr"),
            delta("newLoanProceeds", derived.newLoanProceeds, "fr"),
          ],
          notes,
        ),
      };
    },
  },
  {
    name: "savings",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft: {
          ...draft,
          reserveFr: derived.reserveEnd,
          // Pre-upkeep. Step 8 overwrites it with what survived.
          micStock: derived.micStockEndPreUpkeep,
        },
        record: record(
          "savings",
          [
            delta("reserveAddApplied", derived.reserveAddApplied, "fr"),
            delta("reserveWithdrawApplied", derived.reserveWithdrawApplied, "fr"),
            delta("reserveEnd", derived.reserveEnd, "fr"),
            delta("micStockEnd", derived.micStockEndPreUpkeep, "mic"),
            delta("micUpkeepDue", derived.micUpkeepDue, "fr"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "debt-service",
    run: ({ derived, draft }: StepInput): StepOutput => {
      const byId = new Map(derived.loanService.map((entry) => {
        return [entry.loanId, entry];
      }));
      const notes: string[] = [];
      const loans: Loan[] = [];

      for (const loan of draft.loans) {
        const service = byId.get(loan.id);
        if (service === undefined || !service.serviced) {
          loans.push(loan);
          continue;
        }
        const principal = service.principalNext;
        // ADDITION 3: a loan that closes leaves the array. Spec 14.3 says a loan
        // "always closes at exactly 0" but never says to remove it, and a kept
        // zero loan would demand 0 forever and grow the array without bound.
        if (roundTo(principal, ECONOMY_CONSTANTS.POINT_DECIMALS) <= 0) {
          notes.push("loan " + loan.id + " repaid in full and closed");
          continue;
        }
        if (service.shortfall > 0) {
          notes.push(
            "loan " + loan.id + " short by " + service.shortfall.toFixed(2)
            + " FR; unpaid interest capitalises",
          );
        }
        loans.push({
          ...loan,
          principal,
          turnsRemaining: service.turnsRemainingNext,
        });
      }

      return {
        draft: {
          ...draft,
          loans,
          debtStatus: derived.debtStatusNext,
          defaultLastTurn: derived.defaultLastTurnNext,
        },
        record: record(
          "debt-service",
          [
            delta("debtRequiredTotal", derived.debtRequiredTotal, "fr"),
            delta("debtAllocatedTotal", derived.debtAllocatedTotal, "fr"),
            delta("debtShortfallTotal", derived.debtShortfallTotal, "fr"),
            delta("debtRatingPenalty", derived.debtRatingPenalty, "rating"),
          ],
          notes,
        ),
      };
    },
  },
  {
    name: "upkeep",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft: { ...draft, micStock: derived.micStockEnd },
        record: record(
          "upkeep",
          [
            delta("micUpkeepPaid", derived.micUpkeepPaid, "fr"),
            delta("micStockLost", derived.micStockLost, "mic"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "spending",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft,
        record: record(
          "spending",
          [
            delta("frAvailable", derived.frAvailable, "fr"),
            delta("frSpent", derived.frSpent, "fr"),
            delta("frRemainder", derived.frRemainder, "fr"),
            delta("micAvailable", derived.micAvailable, "mic"),
            delta("micSpent", derived.micSpent, "mic"),
            delta("micRemainder", derived.micRemainder, "mic"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "auto-invest",
    run: ({ derived, draft }: StepInput): StepOutput => {
      return {
        draft,
        record: record(
          "auto-invest",
          [
            delta("investedObor", derived.investedObor, "obor"),
            delta("autoInvestGrowthPp", derived.autoInvestGrowthPp, "pp"),
          ],
          ["both remainders are now discarded — points do not carry over"],
        ),
      };
    },
  },
  {
    name: "growth",
    run: ({ derived, draft }: StepInput): StepOutput => {
      const deltas = [
        delta("modifierPp", derived.modifierPp, "pp"),
        delta("overallGrowthPct", derived.overallGrowthPct, "pct"),
      ];
      for (const sector of derived.sectors) {
        deltas.push(delta(sector.key + " finalPct", sector.finalPct, "pct"));
      }
      return { draft, record: record("growth", deltas, []) };
    },
  },
  {
    name: "gdp",
    run: ({ state, derived, draft }: StepInput): StepOutput => {
      // The grant created at step 4 carries this turn's `nextConcessionId`.
      const grantId = finiteOr(state.nextConcessionId, 1);
      const next = derived.concessionGranted
        ? {
          ...draft,
          concessions: draft.concessions.map((concession) => {
            if (concession.id !== grantId) {
              return concession;
            }
            return { ...concession, gdpTransferredObor: derived.concessionCostObor };
          }),
        }
        : draft;
      return {
        draft: next,
        record: record(
          "gdp",
          [
            delta("gdpNextTotalObor", derived.gdpNextTotalObor, "obor"),
            delta("gdpChangeObor", derived.gdpChangeObor, "obor"),
            delta("concessionCostObor", derived.concessionCostObor, "obor"),
          ],
          [],
        ),
      };
    },
  },
  {
    name: "rating",
    run: ({ derived, draft }: StepInput): StepOutput => {
      const deltas = derived.ratingDeltas.map((line) => {
        return delta(line.reason, line.points, "rating");
      });
      deltas.push(delta("ratingNext", derived.ratingNext, "rating"));
      const notes = [
        derived.ratingCleanTurn
          ? "clean turn: no emission, no missed payment, positive growth — +"
            + derived.ratingRecovery
          : "not a clean turn, so no automatic recovery",
      ];
      return { draft, record: record("rating", deltas, notes) };
    },
  },
  {
    name: "flags",
    run: ({ state, derived, draft }: StepInput): StepOutput => {
      const action = derived.action;
      const notes: string[] = [];

      // A modifier created at step 4 IS decremented here, 2 -> 1, so
      // ACTION_EFFECT_TURNS = 2 means "this turn and the next".
      const timedModifiers = draft.timedModifiers
        .map((modifier) => {
          return {
            ...modifier,
            turnsRemaining: Math.max(0, finiteOr(modifier.turnsRemaining, 0) - 1),
          };
        })
        .filter((modifier) => {
          return modifier.turnsRemaining > 0;
        });
      const expired = draft.timedModifiers.length - timedModifiers.length;

      const natResolved = action.resolved && action.kind === "nationalization";
      const privResolved = action.resolved && action.kind === "privatization";
      if (natResolved) {
        notes.push("nationalization cooldown reset");
      }
      if (privResolved) {
        notes.push("privatization cooldown reset");
      }

      const stockNextByKey = new Map(derived.resources.map((resource) => {
        return [resource.key, resource.stockNextUnits];
      }));

      return {
        draft: {
          ...draft,
          timedModifiers,
          privatizationFrDragTurns: Math.max(
            0,
            finiteOr(draft.privatizationFrDragTurns, 0) - 1,
          ),
          privatizationMicDragTurns: Math.max(
            0,
            finiteOr(draft.privatizationMicDragTurns, 0) - 1,
          ),
          turnsSinceNationalization: natResolved
            ? 0
            : finiteOr(state.turnsSinceNationalization, 0) + 1,
          turnsSincePrivatization: privResolved
            ? 0
            : finiteOr(state.turnsSincePrivatization, 0) + 1,
          sectors: draft.sectors.map((sector) => {
            return { ...sector, growthTemporaryPct: 0 };
          }),
          pendingAction: null,
          pendingConcession: null,
          borrowRequest: 0,
          reserveAdd: 0,
          reserveWithdraw: 0,
          micStockAdd: 0,
          micStockWithdraw: 0,
          resources: draft.resources.map((resource) => {
            return {
              ...resource,
              stockUnits: stockNextByKey.get(resource.key) ?? 0,
              importsRequested: 0,
              exports: 0,
            };
          }),
          emissionPctLast: finiteOr(state.emissionPct, 0),
          militaryPctLast: finiteOr(state.militaryPct, 0),
        },
        record: record(
          "flags",
          [
            delta("expired modifiers", expired, "count"),
            delta("cleared one-shot inputs", 7, "count"),
          ],
          notes,
        ),
      };
    },
  },
  {
    name: "commit",
    run: ({ state, derived, draft }: StepInput): StepOutput => {
      const nextByKey = new Map(derived.sectors.map((sector) => {
        return [sector.key, sector.gdpNextObor];
      }));
      const points = ECONOMY_CONSTANTS.POINT_DECIMALS;

      // The storage-precision pass. Every number that lands in the document is
      // rounded to its unit's stored precision and passes `finiteOr` first,
      // because `sanitizeRecord` DROPS a NaN key rather than nulling it (G23).
      const next: EconomyState = {
        ...draft,
        turn: finiteOr(state.turn, 1) + 1,
        ratingScore: derived.ratingNext,
        controlPosition: derived.controlNext,
        sectors: draft.sectors.map((sector) => {
          return {
            ...sector,
            gdpObor: roundTo(finiteOr(nextByKey.get(sector.key) ?? sector.gdpObor, 0), 0),
            growthPermanentPct: roundTo(
              finiteOr(sector.growthPermanentPct, 0),
              ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
            ),
            growthTemporaryPct: 0,
          };
        }),
        reserveFr: roundTo(finiteOr(draft.reserveFr, 0), points),
        micStock: roundTo(finiteOr(draft.micStock, 0), points),
        loans: draft.loans.map((loan) => {
          return {
            ...loan,
            principal: roundTo(finiteOr(loan.principal, 0), points),
            allocatedFr: roundTo(finiteOr(loan.allocatedFr, 0), points),
          };
        }),
        resources: draft.resources.map((resource) => {
          return { ...resource, stockUnits: roundTo(finiteOr(resource.stockUnits, 0), 0) };
        }),
        timedModifiers: draft.timedModifiers.map((modifier) => {
          return {
            ...modifier,
            growthPp: roundTo(
              finiteOr(modifier.growthPp, 0),
              ECONOMY_CONSTANTS.PCT_STORE_DECIMALS,
            ),
          };
        }),
        concessions: draft.concessions.map((concession) => {
          return {
            ...concession,
            gdpTransferredObor: roundTo(finiteOr(concession.gdpTransferredObor, 0), 0),
          };
        }),
        emissionPct: roundTo(finiteOr(draft.emissionPct, 0), ECONOMY_CONSTANTS.PCT_STORE_DECIMALS),
        militaryPct: roundTo(finiteOr(draft.militaryPct, 0), ECONOMY_CONSTANTS.PCT_STORE_DECIMALS),
      };

      return {
        draft: next,
        record: record(
          "commit",
          [
            delta("turn", next.turn, "turns"),
            delta("gdpTotalObor", derived.gdpNextTotalObor, "obor"),
            delta("ratingScore", next.ratingScore, "rating"),
            delta("controlPosition", next.controlPosition, "count"),
          ],
          [],
        ),
      };
    },
  },
];

function resolveTurn(state: EconomyState, context?: EconomyContext): TurnResolution {
  const ctx = context ?? DEFAULT_CONTEXT;
  // Step 1 IS the derive pass, run for its errors. Nothing may be written on
  // invalid input, and half the rules cannot be checked without the derived
  // numbers, so this is the only step that can abort.
  const derived = deriveEconomy(state, ctx);
  if (derived.errors.length > 0) {
    return { ok: false, errors: derived.errors };
  }

  let draft = copyState(state);
  const steps: TurnStepRecord[] = [];
  for (const step of TURN_STEPS) {
    const output = step.run({ state, derived, draft, context: ctx });
    draft = output.draft;
    steps.push(output.record);
  }

  const turnRecord = buildTurnRecord(state, derived, steps);
  return {
    ok: true,
    next: { ...draft, history: pushTurnRecord(draft.history, turnRecord) },
    record: turnRecord,
  };
}

export { STEP_NAMES, TURN_STEPS, copyState, resolveTurn };
