import { signal } from "@preact/signals-react";
import type { Signal } from "@preact/signals-react";
import type { TResourceId } from "../core/exports";
import type { TScreenPoint } from "./ui-state";

/**
 * The tax-phase animation queue (plan §4.5). One flight is one glyph travelling
 * a quadratic bezier from a hex to its HUD chip. The two timestamps are kept so
 * the probe can measure the 350 ms gap between the last landing and the insane
 * conversion.
 *
 * Signal contents are immutable: an action replaces a whole value and never
 * mutates one in place.
 */

/** Both `from`, `control` and `to` are viewport pixels, so the layer can be fixed-position. */
type TFlight = {
  readonly id: string;
  readonly hexId: string;
  readonly resource: TResourceId;
  readonly amount: number;
  readonly from: TScreenPoint;
  readonly control: TScreenPoint;
  readonly to: TScreenPoint;
  /** `performance.now()` of the moment this glyph leaves its hex. */
  readonly startMs: number;
  readonly landed: boolean;
};

/**
 * `idle` before the phase, `flying` while glyphs travel, `pause` during the
 * 350 ms wait, `insane` while the conversion runs, `done` once the phase ended.
 */
type TTaxStage = "idle" | "flying" | "pause" | "insane" | "done";

type TAnimState = {
  readonly flights: Signal<readonly TFlight[]>;
  /** The centre of every `.resource-chip`, measured once when the phase starts. */
  readonly hudAnchors: Signal<Readonly<Partial<Record<TResourceId, TScreenPoint>>>>;
  readonly taxStage: Signal<TTaxStage>;
  /** The chip that should flash right now, or null. */
  readonly pulse: Signal<TResourceId | null>;
  readonly lastLandingMs: Signal<number | null>;
  readonly insaneAtMs: Signal<number | null>;
};

/** One glyph travels this long, whatever the distance. */
const FLIGHT_MS = 700;

/** The gap between two consecutive departures. */
const FLIGHT_STAGGER_MS = 60;

/** The spec pause between the last landing and the insane conversion. */
const INSANE_DELAY_MS = 350;

/** How long a chip keeps its pulse class. */
const PULSE_MS = 300;

/** The insane chip flashes red for longer, because it is the punchline. */
const ALARM_PULSE_MS = 900;

/** The glyph each flight carries, and the glyph the log summary prints. */
const RESOURCE_GLYPHS: Readonly<Record<TResourceId, string>> = {
  food: "🍗",
  stone: "🪨",
  wood: "🪵",
  population: "🧍",
  hammers: "⚒️",
  science: "📖",
  scouting: "🔭",
  mana: "💠",
  toxicity: "☣️",
  insane: "🤖",
};

const NO_FLIGHTS: readonly TFlight[] = [];

const createAnimState = (): TAnimState => {
  return {
    flights: signal<readonly TFlight[]>(NO_FLIGHTS),
    hudAnchors: signal<Readonly<Partial<Record<TResourceId, TScreenPoint>>>>({}),
    taxStage: signal<TTaxStage>("idle"),
    pulse: signal<TResourceId | null>(null),
    lastLandingMs: signal<number | null>(null),
    insaneAtMs: signal<number | null>(null),
  };
};

export type { TAnimState, TFlight, TTaxStage };

export {
  ALARM_PULSE_MS,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  INSANE_DELAY_MS,
  NO_FLIGHTS,
  PULSE_MS,
  RESOURCE_GLYPHS,
  createAnimState,
};
