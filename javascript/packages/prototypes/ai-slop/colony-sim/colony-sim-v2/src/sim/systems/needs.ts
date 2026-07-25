import type { World } from "../world";

const HUNGER_PER_TICK = 0.0008;
const FATIGUE_PER_TICK = 0.0006;

// Needs decay over time. Later this flips job priority (eat/sleep) — for now it
// only drives the HUD readout.
function needsSystem(world: World): void {
  for (const [, needs] of world.needs) {
    needs.hunger = Math.min(1, needs.hunger + HUNGER_PER_TICK);
    needs.fatigue = Math.min(1, needs.fatigue + FATIGUE_PER_TICK);
  }
}

export { needsSystem };
