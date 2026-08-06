import assert from "node:assert/strict";
import test from "node:test";
import { BASE_SECTOR_KEYS, ECONOMY_CONSTANTS, RESOURCE_KEYS } from "./constants";
import { createInitialEconomy, createResourceState, createSector } from "./economy-state";
import { deriveEconomy } from "./derive";

test("a fresh country opens on the sourced standard start", () => {
  const state = createInitialEconomy();

  assert.equal(state.turn, 1);
  assert.equal(state.schemaVersion, ECONOMY_CONSTANTS.ECONOMY_SCHEMA_VERSION);
  assert.deepEqual(
    state.sectors.map((sector) => {
      return sector.key;
    }),
    [...BASE_SECTOR_KEYS],
  );
  const total = state.sectors.reduce((sum, sector) => {
    return sum + sector.gdpObor;
  }, 0);
  assert.equal(total, ECONOMY_CONSTANTS.START_GDP_OBOR);
  assert.equal(state.ratingScore, 70);
  assert.equal(state.controlPosition, 50);
  assert.equal(state.emissionPct, 0);
  assert.equal(state.militaryPct, 10);
  assert.equal(state.debtAutoService, true);
  assert.equal(state.debtStatus, "normal");
  assert.equal(state.region, "none");
});

test("both cooldowns start satisfied, so nothing is locked at turn 1", () => {
  const state = createInitialEconomy();
  assert.equal(state.turnsSinceNationalization, ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS);
  assert.equal(state.turnsSincePrivatization, ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS);
  const derived = deriveEconomy(state);
  assert.equal(derived.nationalizationAvailable, true);
  assert.equal(derived.privatizationAvailable, true);
});

test("a fresh country has no geology, so it starts in a full shortage", () => {
  // DESIGN addition 5: the spec never states a starting geology and the engine
  // cannot invent one — a judge sets deposits. This is a legitimate state.
  const state = createInitialEconomy();
  assert.deepEqual(
    state.resources.map((resource) => {
      return resource.key;
    }),
    [...RESOURCE_KEYS],
  );
  for (const resource of state.resources) {
    assert.equal(resource.deposits, 0);
  }

  const derived = deriveEconomy(state);
  assert.deepEqual(derived.errors, [], "a full shortage is not an invalid state");
  for (const sector of derived.sectors) {
    if (sector.key === "other1" || sector.key === "other2") {
      continue;
    }
    assert.equal(sector.finalPct, 0, sector.key + " is zeroed, never driven negative");
  }
});

test("each factory returns a fresh object, never a shared one", () => {
  const first = createInitialEconomy();
  const second = createInitialEconomy();
  first.sectors[0]!.gdpObor = 1;
  assert.equal(second.sectors[0]?.gdpObor, ECONOMY_CONSTANTS.START_SECTOR_GDP_OBOR);
  assert.notEqual(createSector("agriculture"), createSector("agriculture"));
  assert.notEqual(createResourceState("coal"), createResourceState("coal"));
});
