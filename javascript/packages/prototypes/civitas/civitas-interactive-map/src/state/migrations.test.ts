import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATIONS, assertChain, runMigrations } from "./migrations";
import type { Migration, MigrationDoc } from "./migrations";

// The shipped chain is empty because version 1 is the first schema. The loop is
// still exercised here with a synthetic chain, so it is not dead code waiting
// for T11 to discover it is broken.

function step(from: number, tag: string): Migration {
  return {
    from,
    to: from + 1,
    migrate(doc: MigrationDoc): MigrationDoc {
      const trail = Array.isArray(doc.trail) ? doc.trail : [];
      return { ...doc, version: from + 1, trail: [...trail, tag] };
    },
  };
}

test("the shipped chain is empty and valid", () => {
  assert.equal(MIGRATIONS.length, 0);
  assert.doesNotThrow(() => {
    assertChain(MIGRATIONS);
  });
});

test("a document already at the target version is returned untouched", () => {
  const doc: MigrationDoc = { version: 1, countries: [] };
  const result = runMigrations(doc, 1, 1);

  assert.equal(result.doc, doc);
  assert.deepEqual(result.applied, []);
});

test("a two-step chain runs in order and feeds each step the previous output", () => {
  const chain = [step(1, "one-to-two"), step(2, "two-to-three")];
  const result = runMigrations({ version: 1 }, 1, 3, chain);

  assert.deepEqual(result.applied, [1, 2]);
  assert.equal(result.doc.version, 3);
  assert.deepEqual(result.doc.trail, ["one-to-two", "two-to-three"]);
});

test("a chain longer than the target stops at the target", () => {
  const chain = [step(1, "a"), step(2, "b"), step(3, "c")];
  const result = runMigrations({ version: 1 }, 1, 2, chain);

  assert.deepEqual(result.applied, [1]);
  assert.deepEqual(result.doc.trail, ["a"]);
});

test("assertChain rejects a gap, a repeat and a descending order", () => {
  const gap: Migration[] = [{ from: 1, to: 3, migrate: (doc) => doc }];
  assert.throws(() => {
    assertChain(gap);
  }, /must move exactly one version/);

  assert.throws(() => {
    assertChain([step(1, "a"), step(1, "b")]);
  }, /two migrations start from state version 1/);

  assert.throws(() => {
    assertChain([step(2, "b"), step(1, "a")]);
  }, /ascending/);
});

test("a version with no step, and a version newer than the target, both throw", () => {
  assert.throws(() => {
    runMigrations({ version: 0 }, 0, 1);
  }, /no migration from state version 0/);

  assert.throws(() => {
    runMigrations({ version: 9 }, 9, 1);
  }, /newer than this build/);
});
