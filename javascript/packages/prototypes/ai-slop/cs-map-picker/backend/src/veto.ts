import { MAP_POOL } from "./maps.ts";

type TFormat = "bo1" | "bo3";
type TSide = "a" | "b";
type TActionKind = "ban" | "pick";

type TAction = {
  step: number;
  side: TSide;
  kind: TActionKind;
  map: string;
};

type TNextStep = {
  step: number;
  side: TSide;
  kind: TActionKind;
};

type TVeto = {
  phase: "waiting" | "veto" | "done";
  next: TNextStep | null;
  remaining: string[];
  decider: string | null;
  // Maps in the order they are played: BO1 has the decider only, BO3 has both picks and then the decider.
  playOrder: string[];
};

// Each format alternates sides, starting with the coin-toss winner. Eight maps minus seven steps leave one decider.
const SEQUENCES: Record<TFormat, TActionKind[]> = {
  bo1: ["ban", "ban", "ban", "ban", "ban", "ban", "ban"],
  bo3: ["ban", "ban", "pick", "pick", "ban", "ban", "ban"],
};

const FORMATS = Object.keys(SEQUENCES) as TFormat[];

const isFormat = (value: unknown): value is TFormat => {
  return typeof value === "string" && FORMATS.includes(value as TFormat);
};

const otherSide = (side: TSide): TSide => {
  return side === "a" ? "b" : "a";
};

const sideOfStep = (firstSide: TSide, step: number): TSide => {
  return step % 2 === 0 ? firstSide : otherSide(firstSide);
};

const computeVeto = (format: TFormat, firstSide: TSide | null, actions: TAction[]): TVeto => {
  const used = new Set(actions.map((action) => action.map));
  const remaining = MAP_POOL.map((map) => map.id).filter((id) => !used.has(id));
  const picks = actions.filter((action) => action.kind === "pick").map((action) => action.map);
  const sequence = SEQUENCES[format];

  if (firstSide === null) {
    return { phase: "waiting", next: null, remaining, decider: null, playOrder: [] };
  }

  const step = actions.length;
  const kind = sequence[step];
  if (kind === undefined) {
    const decider = remaining[0] ?? null;
    const playOrder = decider === null ? picks : [...picks, decider];
    return { phase: "done", next: null, remaining, decider, playOrder };
  }

  return {
    phase: "veto",
    next: { step, side: sideOfStep(firstSide, step), kind },
    remaining,
    decider: null,
    playOrder: picks,
  };
};

// Returns the action to store, or an error text for the client.
const resolveAction = (veto: TVeto, side: TSide, map: string): TAction | string => {
  if (veto.phase !== "veto" || veto.next === null) {
    return "Пики не идут";
  }
  if (veto.next.side !== side) {
    return "Сейчас ход соперника";
  }
  if (!veto.remaining.includes(map)) {
    return "Эта карта уже недоступна";
  }

  return { step: veto.next.step, side, kind: veto.next.kind, map };
};

export type { TFormat, TSide, TAction, TActionKind, TVeto, TNextStep };
export { SEQUENCES, FORMATS, isFormat, otherSide, computeVeto, resolveAction };
