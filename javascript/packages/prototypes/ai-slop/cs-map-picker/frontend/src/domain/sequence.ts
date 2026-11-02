import type { TActionKind, TFormat, TSide } from "./types";

// Mirrors backend/src/veto.ts: sides alternate, starting with the coin-toss winner.
const SEQUENCES: Record<TFormat, TActionKind[]> = {
  bo1: ["ban", "ban", "ban", "ban", "ban", "ban", "ban"],
  bo3: ["ban", "ban", "pick", "pick", "ban", "ban", "ban"],
};

const sideOfStep = (firstSide: TSide, step: number): TSide => {
  if (step % 2 === 0) {
    return firstSide;
  }
  return firstSide === "a" ? "b" : "a";
};

export { SEQUENCES, sideOfStep };
