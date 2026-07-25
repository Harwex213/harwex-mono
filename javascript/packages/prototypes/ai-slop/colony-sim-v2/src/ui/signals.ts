import { signal } from "@preact/signals";
import type { EntityId } from "@/sim/components";

// The reactivity boundary: ONLY what the DOM HUD renders. Per-entity hot data
// (positions, needs of hundreds of colonists) stays in plain Maps on the World
// and is read directly by the renderer — never mirrored into signals.
const gameTick = signal(0);
const colonistCount = signal(0);
const storedWood = signal(0);
const speed = signal(1);
const paused = signal(false);
const selectedId = signal<EntityId | null>(null);

export { gameTick, colonistCount, storedWood, speed, paused, selectedId };
