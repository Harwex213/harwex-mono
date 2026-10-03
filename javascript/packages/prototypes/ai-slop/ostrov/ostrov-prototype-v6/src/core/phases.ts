import { ICONS } from "./icons";
import type { TPhase } from "./types";

/**
 * The four phases of the core loop, in the order the spec lists them. The
 * end-turn wheel draws them in this order, the turn panel names them, and the
 * turn counter walks them.
 */

type TPhaseMeta = {
  readonly id: TPhase;
  readonly label: string;
  readonly short: string;
  readonly icon: string;
};

const PHASES: readonly TPhaseMeta[] = [
  { id: "build", label: "Фаза строительства", short: "Строительство", icon: ICONS.hammers },
  { id: "tax", label: "Фаза сбора налогов", short: "Налоги", icon: ICONS.food },
  { id: "scout", label: "Фаза разведки", short: "Разведка", icon: ICONS.scouting },
  { id: "clear", label: "Фаза зачистки", short: "Зачистка", icon: ICONS.army },
];

const phaseIndex = (id: TPhase) => PHASES.findIndex((phase) => phase.id === id);

const getPhase = (id: TPhase) => {
  const phase = PHASES.find((candidate) => candidate.id === id);
  if (!phase) {
    throw new Error(`Unknown phase: ${id}`);
  }

  return phase;
};

export type { TPhaseMeta };
export { getPhase, phaseIndex, PHASES };
