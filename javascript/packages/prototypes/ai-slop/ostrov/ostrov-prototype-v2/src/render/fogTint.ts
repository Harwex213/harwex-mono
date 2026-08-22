import { config } from "@hw/ostrov-prototype-v2-config";
import type { TerrainKind, TerrainStyle } from "../map/terrain";
import { TERRAIN_KINDS, TERRAIN_STYLES } from "../map/terrain";
import { ROCK_BOTTOM, ROCK_TOP, mix } from "./palette";

/**
 * What a tile is painted with at a given fog level.
 *
 * Dimming a tile means mixing every colour it uses towards the fog tone, and
 * mixing colours is string work — far too much of it to do per tile per frame.
 * The level is therefore quantised into a fixed ladder and the whole ladder is
 * built once at load: five biomes by two dozen steps is a hundred and twenty
 * prepared palettes, and drawing a remembered tile then costs exactly what
 * drawing a lit one costs, minus the decoration it no longer shows.
 *
 * The top rung is the untouched palette, character for character, so a tile in
 * full sight is painted with the same strings it was painted with before there
 * was any fog at all.
 */

/** Rungs of the ladder. Twenty-four steps put the banding well under a tone. */
const FOG_STEPS = 24;

/** Below this level the live decoration is gone entirely and is not drawn. */
const DECOR_FLOOR = 0.34;

/** At and above this level the decoration is at full strength. */
const DECOR_FULL = 0.88;

type FogPaint = {
  style: TerrainStyle;
  /** Bright lip of the cliff, already tinted. */
  rockTop: string;
  /** Deep rock at the foot of the cliff, already tinted. */
  rockBottom: string;
  /** How strongly the live decoration shows, 0…1. Zero means skip it. */
  decorAlpha: number;
};

function tint(colour: string, amount: number): string {
  if (amount <= 0) {
    return colour;
  }
  return mix(colour, config.fog.fogColor, amount);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildLadder(): Record<TerrainKind, FogPaint>[] {
  const rungs: Record<TerrainKind, FogPaint>[] = [];
  for (let step = 0; step < FOG_STEPS; step += 1) {
    const level = step / (FOG_STEPS - 1);
    const amount = (1 - level) * config.fog.tintStrength;
    const rockTop = tint(ROCK_TOP, amount);
    const rockBottom = tint(ROCK_BOTTOM, amount);
    const decorAlpha = smoothstep(DECOR_FLOOR, DECOR_FULL, level);
    const rung = {} as Record<TerrainKind, FogPaint>;
    for (const kind of TERRAIN_KINDS) {
      const style = TERRAIN_STYLES[kind];
      rung[kind] = {
        style:
          amount <= 0
            ? style
            : {
                label: style.label,
                top: tint(style.top, amount),
                rim: tint(style.rim, amount),
                wall: tint(style.wall, amount),
              },
        rockTop,
        rockBottom,
        decorAlpha,
      };
    }
    rungs.push(rung);
  }
  return rungs;
}

const LADDER = buildLadder();

const TOP_RUNG = FOG_STEPS - 1;

/** The prepared palette for a tile at this fog level. Never allocates. */
function fogPaint(terrain: TerrainKind, level: number): FogPaint {
  if (level >= 1) {
    return LADDER[TOP_RUNG]![terrain];
  }
  const step = Math.max(0, Math.round(level * TOP_RUNG));
  return LADDER[step]![terrain];
}

export type { FogPaint };
export { fogPaint };
