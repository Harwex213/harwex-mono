/**
 * Model layer — seeded RNG (GDD §0, §15.3).
 *
 * The GDD insists every random outcome be **deterministic given the same seed**
 * so a battle replays identically (§0, §15.3 footnote). All in-battle dice — for
 * now just the ruler fate d3 (§11.3) — draw from one {@link SeededRng} owned by
 * the store, so re-seeding and replaying produce the same sequence.
 *
 * The generator is **mulberry32**: a tiny, fast 32-bit PRNG with a full period
 * over its state and good enough distribution for tactical dice. It is pure
 * given its seed and carries no global state, keeping the engine testable.
 */

/** The default battle seed when none is supplied — replayable out of the box. */
export const DEFAULT_SEED = 0xc0ffee;

export class SeededRng {
  /** 32-bit internal state, advanced on every draw. */
  private state: number;

  constructor(seed: number = DEFAULT_SEED) {
    this.state = seed >>> 0;
  }

  /** The next float in `[0, 1)` (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Roll a die with `sides` faces, returning `1..sides` (e.g. `roll(3)` → d3, §11.3). */
  roll(sides: number): number {
    return 1 + Math.floor(this.next() * sides);
  }
}
