import type { TArchetypeId } from "./archetypes";

type TTeam = "player" | "enemy";

/** A unit as it lives between battles: an archetype and a free position. */
type TRosterUnit = {
  id: string;
  team: TTeam;
  archetypeId: TArchetypeId;
  x: number;
  y: number;
};

type TFighter = {
  id: string;
  team: TTeam;
  archetypeId: TArchetypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  retargetIn: number;
  targetId: string | null;
  /** 1 right after a strike, fading to 0 — drives the lunge animation. */
  swing: number;
  facing: number;
  hitFlash: number;
  healFlash: number;
  dead: boolean;
  deathAge: number;
};

type TProjectile = {
  id: string;
  kind: "arrow" | "mote";
  team: TTeam;
  x: number;
  y: number;
  angle: number;
  speed: number;
  damage: number;
  heal: number;
  targetId: string;
};

type TFloater = {
  id: string;
  x: number;
  y: number;
  text: string;
  tone: "damage" | "heal";
  age: number;
  life: number;
};

type TOutcome = "running" | "player" | "enemy" | "draw";

type TSimulation = {
  fighters: TFighter[];
  projectiles: TProjectile[];
  floaters: TFloater[];
  /** Battle log lines produced since the last drain. */
  events: string[];
  time: number;
  /** Leftover frame time waiting for the next fixed step. */
  carry: number;
  outcome: TOutcome;
  nextId: number;
};

export type { TFighter, TFloater, TOutcome, TProjectile, TRosterUnit, TSimulation, TTeam };
