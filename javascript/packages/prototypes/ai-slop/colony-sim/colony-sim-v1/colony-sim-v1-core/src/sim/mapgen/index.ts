// The registry. Adding a map style = one module next door + one line here;
// every caller picks a map by id, so nothing outside this folder names a
// generator's implementation.

import { dividedLands } from "./divided-lands";
import { noiseBands } from "./noise-bands";
import type { MapGenerator, MapGenResult } from "./types";

// Keys spelled out rather than taken from `generator.id`: they are the ids other
// packages and saved games pass around, and only a literal makes MapGenId a
// union the compiler can check a call site against.
const MAP_GENERATORS = {
  "noise-bands": noiseBands,
  "divided-lands": dividedLands,
} as const satisfies Record<string, MapGenerator>;

type MapGenId = keyof typeof MAP_GENERATORS;

const DEFAULT_MAP_GEN: MapGenId = "divided-lands";

// Unknown ids come from outside (a URL, an old save, a lobby setting), so they
// fall back to the default rather than crash a boot.
function getMapGenerator(id: string): MapGenerator {
  return MAP_GENERATORS[id as MapGenId] ?? MAP_GENERATORS[DEFAULT_MAP_GEN];
}

function listMapGenerators(): MapGenerator[] {
  return Object.values(MAP_GENERATORS);
}

export type { MapGenerator, MapGenId, MapGenResult };
export { DEFAULT_MAP_GEN, getMapGenerator, listMapGenerators, MAP_GENERATORS };
