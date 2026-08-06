// Every shape the economics engine consumes and produces.
//
// The authority is `.plan/T11/FORMULA-SPEC.md` section 18. The state types below
// mirror it field for field. The stage types after them are T11-B's own: the
// derive pass evaluates every formula exactly once (spec 16.2) and hands each
// stage's output to the pipeline, so a stage needs a named result type.
//
// No runtime code lives here. `types.ts` is erased entirely at build time.

type SectorKey =
  | "agriculture"
  | "lightIndustry"
  | "heavyIndustry"
  | "commercial"
  | "extraction"
  | "other1"
  | "other2";

type ResourceKey =
  | "coal"
  | "oil"
  | "fibre"
  | "ferrous"
  | "nonferrous"
  | "rubber"
  | "chemical"
  | "precious";

type ResourceCategory = "fuel" | "raw" | "luxury";

type RatingTier = "A+" | "A" | "B" | "C" | "D" | "E" | "F";

type Region = "none" | "bengo" | "aglan" | "sudhara" | "badiyat";

type DebtStatus = "normal" | "arrears" | "default";

type ActionKind = "nationalization" | "privatization";

type EnterpriseKind = "civilian" | "military";

type Sector = {
  key: SectorKey;
  name: string;
  grounds: string | null;
  gdpObor: number;
  growthPermanentPct: number;
  growthTemporaryPct: number;
};

type ResourceState = {
  key: ResourceKey;
  stockUnits: number;
  deposits: number;
  extractionBonusPct: number;
  importsRequested: number;
  exports: number;
  blockadePct: number;
};

type Loan = {
  id: number;
  principal: number;
  ratePct: number;
  termTurns: number;
  turnsRemaining: number;
  createdTurn: number;
  allocatedFr: number;
};

type LedgerLine = {
  label: string;
  points: number;
};

type TimedModifier = {
  id: number;
  reason: string;
  growthPp: number;
  turnsRemaining: number;
};

type PendingAction = {
  kind: ActionKind;
  enterprise: EnterpriseKind;
  roll: number;
};

type PendingConcession = {
  sectorKey: SectorKey;
};

type Concession = {
  id: number;
  sectorKey: SectorKey;
  gdpTransferredObor: number;
  grantedTurn: number;
  active: boolean;
};

type TurnStepRecord = {
  step: string;
  deltas: { label: string; value: number; unit: string }[];
  notes: string[];
};

type TurnRecord = {
  turn: number;
  gdpTotalObor: number;
  gdpNextTotalObor: number;
  overallGrowthPct: number;
  frGenerated: number;
  frRemainder: number;
  micGenerated: number;
  micRemainder: number;
  ratingScore: number;
  ratingNext: number;
  controlPosition: number;
  controlNext: number;
  steps: TurnStepRecord[];
  warnings: string[];
};

type EconomyState = {
  schemaVersion: number;
  turn: number;

  sectors: Sector[];

  ratingScore: number;
  controlPosition: number;

  emissionPct: number;
  emissionPctLast: number;
  militaryPct: number;
  militaryPctLast: number;

  frExpenseLines: LedgerLine[];
  micExpenseLines: LedgerLine[];
  frIncomeLines: LedgerLine[];
  micIncomeLines: LedgerLine[];

  reserveFr: number;
  reserveAdd: number;
  reserveWithdraw: number;

  micStock: number;
  micStockAdd: number;
  micStockWithdraw: number;

  resources: ResourceState[];

  loans: Loan[];
  nextLoanId: number;
  borrowRequest: number;
  debtAutoService: boolean;
  debtStatus: DebtStatus;
  defaultLastTurn: boolean;

  mobilized: boolean;
  mobilizationJustified: boolean;
  region: Region;
  concessions: Concession[];
  nextConcessionId: number;
  pendingConcession: PendingConcession | null;

  pendingAction: PendingAction | null;
  turnsSinceNationalization: number;
  turnsSincePrivatization: number;
  timedModifiers: TimedModifier[];
  nextModifierId: number;
  privatizationFrDragTurns: number;
  privatizationMicDragTurns: number;

  history: TurnRecord[];
};

type SectorDerived = {
  key: SectorKey;
  gdpObor: number;
  share: number;
  basePct: number;
  shortagePenalty: number;
  preShortagePct: number;
  finalPct: number;
  gdpNextObor: number;
};

type ResourceDerived = {
  key: ResourceKey;
  needUnits: number;
  extractionUnits: number;
  importUnits: number;
  onHandUnits: number;
  exportsAppliedUnits: number;
  supplyUnits: number;
  coverage: number;
  shortage: number;
  freeUnits: number;
  stockNextUnits: number;
};

type ValidationError = {
  code: string;
  field: string;
  message: string;
};

type RatingDelta = {
  reason: string;
  points: number;
};

type DebtTerms = {
  limitMultiple: number;
  ratePct: number;
  termTurns: number;
};

type LoanServiceDerived = {
  loanId: number;
  serviced: boolean;
  requiredFr: number;
  allocatedFr: number;
  shortfall: number;
  interestDue: number;
  interestPaid: number;
  principalPaid: number;
  principalNext: number;
  turnsRemainingNext: number;
};

// ---------------------------------------------------------------------------
// Stage results. One per pipeline step of the derive pass (spec 16.2, 2..13).
// ---------------------------------------------------------------------------

type ResourceStage = {
  resources: ResourceDerived[];
  penaltyByKey: Record<SectorKey, number>;
  warnings: string[];
};

type GenerationStage = {
  shareByKey: Record<SectorKey, number>;
  plannedGrowthPct: number;
  ratingTier: RatingTier;
  ratingFactor: number;
  controlBandIndex: number;
  controlBandName: string;
  controlGrowthPp: number;
  controlFrMultiplier: number;
  emissionStepLimitPp: number;
  militaryStepLimitPp: number;
  frTaxBase: number;
  frGrowthFactor: number;
  frDefenceDrag: number;
  frLightBonus: number;
  frRegimeMultiplier: number;
  frCore: number;
  frEmission: number;
  frGenerated: number;
  micHeavyBonus: number;
  micRegimeMultiplier: number;
  micGenerated: number;
  inflationPct: number;
  inflationGrowthPp: number;
  emissionRatingPenalty: number;
  defenceGrowthPp: number;
  mobilizationGrowthPp: number;
};

type ActionStage = {
  kind: ActionKind | null;
  enterprise: EnterpriseKind | null;
  roll: number;
  resolved: boolean;
  success: boolean;
  natFrPayout: number;
  natMicPayout: number;
  ratingDeltas: RatingDelta[];
  controlShift: number;
  timedModifier: { reason: string; growthPp: number; turnsRemaining: number } | null;
  privatizationFrDragTurns: number;
  privatizationMicDragTurns: number;
  nationalizationAvailable: boolean;
  privatizationAvailable: boolean;
  notes: string[];
};

type ConcessionStage = {
  granted: boolean;
  sectorKey: SectorKey | null;
  concessionGrowthPp: number;
};

type BorrowStage = {
  debtLimit: number;
  debtOutstanding: number;
  newLoanAvailable: number;
  newLoanRatePct: number;
  newLoanTermTurns: number;
  createdLoan: Loan | null;
  newLoanProceeds: number;
};

type DebtStage = {
  loanService: LoanServiceDerived[];
  requiredTotal: number;
  allocatedTotal: number;
  shortfallTotal: number;
  ratingPenalty: number;
  statusNext: DebtStatus;
  defaultLastTurnNext: boolean;
  warnings: string[];
};

type SavingsStage = {
  reserveCap: number;
  reserveAddApplied: number;
  reserveWithdrawApplied: number;
  reserveEnd: number;
  reservePenaltyPp: number;
  micStockWithdrawApplied: number;
  micStockEndPreUpkeep: number;
  micUpkeepDue: number;
  warnings: string[];
};

type UpkeepStage = {
  micPointsPaidFor: number;
  micStockLost: number;
  micStockEnd: number;
  micUpkeepPaid: number;
  warnings: string[];
};

type GrowthInput = {
  sectors: readonly Sector[];
  shareByKey: Record<SectorKey, number>;
  penaltyByKey: Record<SectorKey, number>;
  gdpTotalObor: number;
  controlGrowthPp: number;
  mobilizationGrowthPp: number;
  concessionGrowthPp: number;
  timedModifierPp: number;
  autoInvestGrowthPp: number;
  reservePenaltyPp: number;
  inflationGrowthPp: number;
  defenceGrowthPp: number;
};

type GrowthStage = {
  modifierPp: number;
  sectors: SectorDerived[];
  overallGrowthPct: number;
  warnings: string[];
};

type GdpStage = {
  sectors: SectorDerived[];
  gdpNextTotalObor: number;
  gdpChangeObor: number;
  concessionCostObor: number;
  warnings: string[];
};

type RatingInput = {
  ratingScore: number;
  emissionPct: number;
  emissionRatingPenalty: number;
  actionRatingDeltas: readonly RatingDelta[];
  debtRatingPenalty: number;
  shortfallTotal: number;
  overallGrowthPct: number;
  mobilized: boolean;
  mobilizationJustified: boolean;
};

type RatingStage = {
  cleanTurn: boolean;
  recovery: number;
  deltas: RatingDelta[];
  ratingNext: number;
  ratingTierNext: RatingTier;
};

type DerivedEconomy = {
  gdpTotalObor: number;
  plannedGrowthPct: number;
  overallGrowthPct: number;
  gdpNextTotalObor: number;
  gdpChangeObor: number;

  ratingTier: RatingTier;
  ratingFactor: number;
  ratingNext: number;
  ratingCleanTurn: boolean;
  ratingRecovery: number;
  ratingDeltas: RatingDelta[];

  controlBandIndex: number;
  controlBandName: string;
  controlGrowthPp: number;
  controlFrMultiplier: number;
  emissionStepLimitPp: number;
  militaryStepLimitPp: number;
  controlNext: number;

  frGenerated: number;
  frEmission: number;
  frOtherIncome: number;
  frAvailable: number;
  frSpent: number;
  frRemainder: number;
  frBalanceAfterSavings: number;
  frBalanceAfterDebt: number;
  frBalanceAfterUpkeep: number;
  frLightBonus: number;
  frDefenceDrag: number;
  frGrowthFactor: number;
  frRegimeMultiplier: number;

  micGenerated: number;
  micOtherIncome: number;
  micAvailable: number;
  micSpent: number;
  micRemainder: number;
  micHeavyBonus: number;
  micRegimeMultiplier: number;

  reserveCap: number;
  reserveAddApplied: number;
  reserveWithdrawApplied: number;
  reserveEnd: number;
  reservePenaltyPp: number;
  micStockWithdrawApplied: number;
  micStockEnd: number;
  micUpkeepDue: number;
  micUpkeepPaid: number;
  micStockLost: number;

  inflationPct: number;
  inflationGrowthPp: number;
  emissionRatingPenalty: number;
  defenceGrowthPp: number;
  autoInvestGrowthPp: number;
  mobilizationGrowthPp: number;
  concessionGrowthPp: number;
  timedModifierPp: number;
  modifierPp: number;

  debtLimit: number;
  debtOutstanding: number;
  newLoanAvailable: number;
  newLoanRatePct: number;
  newLoanTermTurns: number;
  debtRequiredTotal: number;
  debtShortfallTotal: number;
  debtRatingPenalty: number;
  debtStatusNext: DebtStatus;

  concessionCostObor: number;

  sectors: SectorDerived[];
  resources: ResourceDerived[];
  errors: ValidationError[];
  warnings: string[];

  // ---- DESIGN section 3.3 ADDITION 2: fields the later steps need. -------
  // Spec 16.2 forbids a step from recomputing anything, so every quantity the
  // pipeline consumes has to live in the single derived object. None of these
  // adds a formula; all are [A] by construction.
  natFrPayout: number;
  natMicPayout: number;
  action: ActionStage;
  concessionGranted: boolean;
  concessionSectorKey: SectorKey | null;
  newLoanProceeds: number;
  createdLoan: Loan | null;
  loanService: LoanServiceDerived[];
  frTaxBase: number;
  nationalizationAvailable: boolean;
  privatizationAvailable: boolean;
  // Four more of the same kind, needed by the step records and by the commit:
  frCore: number;
  debtAllocatedTotal: number;
  investedObor: number;
  micStockEndPreUpkeep: number;
  defaultLastTurnNext: boolean;
};

type EconomyContext = {
  provinceCount: number;
};

type TurnResolution =
  | { ok: true; next: EconomyState; record: TurnRecord }
  | { ok: false; errors: ValidationError[] };

type StepInput = {
  state: EconomyState;
  derived: DerivedEconomy;
  draft: EconomyState;
  context: EconomyContext;
};

type StepOutput = {
  draft: EconomyState;
  record: TurnStepRecord;
};

type TurnStep = {
  name: string;
  run: (input: StepInput) => StepOutput;
};

type EconomyFromJsonResult = {
  state: EconomyState;
  repairs: string[];
};

export {
  type ActionKind,
  type ActionStage,
  type BorrowStage,
  type Concession,
  type ConcessionStage,
  type DebtStage,
  type DebtStatus,
  type DebtTerms,
  type DerivedEconomy,
  type EconomyContext,
  type EconomyFromJsonResult,
  type EconomyState,
  type EnterpriseKind,
  type GdpStage,
  type GenerationStage,
  type GrowthInput,
  type GrowthStage,
  type LedgerLine,
  type Loan,
  type LoanServiceDerived,
  type PendingAction,
  type PendingConcession,
  type RatingDelta,
  type RatingInput,
  type RatingStage,
  type RatingTier,
  type Region,
  type ResourceCategory,
  type ResourceDerived,
  type ResourceKey,
  type ResourceStage,
  type ResourceState,
  type SavingsStage,
  type Sector,
  type SectorDerived,
  type SectorKey,
  type StepInput,
  type StepOutput,
  type TimedModifier,
  type TurnRecord,
  type TurnResolution,
  type TurnStep,
  type TurnStepRecord,
  type UpkeepStage,
  type ValidationError,
};
