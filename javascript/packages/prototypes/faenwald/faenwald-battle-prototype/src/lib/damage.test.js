import { describe, test } from "node:test";
import assert from "node:assert";
import { resolveAttack, elevationDamageMult, chargeDamageMult, formationCoverMult } from "./damage.js";

const attacker = (overrides = {}) => ({ attack: 20, hp: 100, maxHp: 100, ...overrides });

describe("resolveAttack", () => {
  test("front, full HP, no terrain mult", () => {
    const result = resolveAttack({ attacker: attacker(), zone: "front", terrainMults: 1 });
    assert.deepStrictEqual(result, { hpDamage: 20, moraleDamage: 20 });
  });

  test("flank multiplies morale damage only", () => {
    const result = resolveAttack({ attacker: attacker(), zone: "flank", terrainMults: 1 });
    assert.strictEqual(result.hpDamage, 20);
    assert.strictEqual(result.moraleDamage, 25);
  });

  test("rear multiplies morale damage only", () => {
    const result = resolveAttack({ attacker: attacker(), zone: "rear", terrainMults: 1 });
    assert.strictEqual(result.hpDamage, 20);
    assert.strictEqual(result.moraleDamage, 30);
  });

  test("terrain multiplier rounds arithmetically", () => {
    const result = resolveAttack({ attacker: attacker({ attack: 15 }), zone: "front", terrainMults: 1.25 });
    assert.strictEqual(result.hpDamage, 19);
    assert.strictEqual(result.moraleDamage, 19);
  });

  test("hard cap at 3x natural damage on HP", () => {
    const result = resolveAttack({ attacker: attacker({ attack: 8 }), zone: "front", terrainMults: 4 });
    assert.strictEqual(result.hpDamage, 24);
    assert.strictEqual(result.moraleDamage, 24);
  });

  test("moraleCapExempt lets morale damage exceed the cap while HP stays capped", () => {
    const result = resolveAttack({
      attacker: attacker({ attack: 10 }),
      zone: "rear",
      terrainMults: 4,
      moraleCapExempt: true,
    });
    assert.strictEqual(result.hpDamage, 30);
    assert.strictEqual(result.moraleDamage, 60);
  });

  test("half damage when attacker is below half max HP", () => {
    const result = resolveAttack({ attacker: attacker({ attack: 20, hp: 40, maxHp: 100 }), zone: "front" });
    assert.deepStrictEqual(result, { hpDamage: 10, moraleDamage: 10 });
  });

  test("exactly half HP is not below half — full damage", () => {
    const result = resolveAttack({ attacker: attacker({ attack: 20, hp: 50, maxHp: 100 }), zone: "front" });
    assert.deepStrictEqual(result, { hpDamage: 20, moraleDamage: 20 });
  });

  test("attackMult scales both pools", () => {
    const result = resolveAttack({
      attacker: attacker(),
      zone: "front",
      terrainMults: 1,
      attackMult: 2,
    });
    assert.deepStrictEqual(result, { hpDamage: 40, moraleDamage: 40 });
  });

  test("attackMult combined with terrainMults is capped at 3x natural", () => {
    const result = resolveAttack({
      attacker: attacker(),
      zone: "front",
      terrainMults: 2,
      attackMult: 2,
    });
    assert.strictEqual(result.hpDamage, 60);
    assert.strictEqual(result.moraleDamage, 60);
  });

  test("extraMoraleMult scales morale only", () => {
    const result = resolveAttack({
      attacker: attacker(),
      zone: "front",
      terrainMults: 1,
      extraMoraleMult: 1.5,
    });
    assert.strictEqual(result.hpDamage, 20);
    assert.strictEqual(result.moraleDamage, 30);
  });

  test("extraMoraleMult is capped unless moraleCapExempt", () => {
    const result = resolveAttack({
      attacker: attacker({ attack: 10 }),
      zone: "rear",
      terrainMults: 4,
      extraMoraleMult: 1.5,
    });
    assert.strictEqual(result.moraleDamage, 30);
  });
});

describe("elevationDamageMult", () => {
  test("attacker one level up", () => {
    assert.strictEqual(elevationDamageMult(1, 0), 1.25);
  });

  test("attacker one level down", () => {
    assert.strictEqual(elevationDamageMult(0, 1), 0.75);
  });

  test("attacker two levels up", () => {
    assert.strictEqual(elevationDamageMult(2, 0), 1.5);
  });

  test("attacker two levels down", () => {
    assert.strictEqual(elevationDamageMult(0, 2), 0.5);
  });

  test("diff of 1 above caps at 1.25 even with a bigger gap", () => {
    assert.strictEqual(elevationDamageMult(2, 1), 1.25);
  });

  test("diff of -1 below", () => {
    assert.strictEqual(elevationDamageMult(1, 2), 0.75);
  });

  test("same elevation", () => {
    assert.strictEqual(elevationDamageMult(0, 0), 1);
  });
});

describe("chargeDamageMult", () => {
  test("no ram, no hexes", () => {
    assert.strictEqual(chargeDamageMult(undefined, 0), 1);
  });

  test("ram present, no hexes advanced", () => {
    assert.strictEqual(chargeDamageMult(8, 0), 1);
  });

  test("ram present, hexes undefined", () => {
    assert.strictEqual(chargeDamageMult(8, undefined), 1);
  });

  test("light cavalry ram over 2 hexes", () => {
    assert.strictEqual(chargeDamageMult(8, 2), 1.16);
  });

  test("heavy cavalry ram over 2 hexes", () => {
    assert.strictEqual(chargeDamageMult(24, 2), 1.48);
  });

  test("heavy cavalry ram over 5 hexes", () => {
    assert.strictEqual(chargeDamageMult(24, 5), 2.2);
  });

  test("medium cavalry ram over 1 hex", () => {
    assert.strictEqual(chargeDamageMult(16, 1), 1.16);
  });
});

describe("formationCoverMult", () => {
  test("no cover", () => {
    assert.strictEqual(formationCoverMult(0), 1);
  });

  test("one flank covered", () => {
    assert.strictEqual(formationCoverMult(1), 0.8);
  });

  test("both flanks covered", () => {
    assert.strictEqual(formationCoverMult(2), 0.6);
  });

  test("more than 2 clamps to the 2-flank multiplier", () => {
    assert.strictEqual(formationCoverMult(3), 0.6);
  });
});

describe("resolveAttack hpMult", () => {
  test("hpMult scales HP only, not morale", () => {
    const result = resolveAttack({
      attacker: attacker({ attack: 20 }),
      zone: "front",
      hpMult: 1.5,
    });
    assert.deepStrictEqual(result, { hpDamage: 30, moraleDamage: 20 });
  });

  test("hpMult stacks with rear morale independently", () => {
    const result = resolveAttack({
      attacker: attacker({ attack: 20 }),
      zone: "rear",
      hpMult: 1.5,
    });
    assert.strictEqual(result.hpDamage, 30);
    assert.strictEqual(result.moraleDamage, 30);
  });

  test("hpMult is subject to the ×3 cap", () => {
    const result = resolveAttack({
      attacker: attacker({ attack: 10 }),
      zone: "front",
      hpMult: 4,
    });
    assert.strictEqual(result.hpDamage, 30);
  });
});
