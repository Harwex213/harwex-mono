import assert from "node:assert/strict";
import test from "node:test";
import { strokeActionFor } from "./stroke";

test("strokeActionFor erases only for the active country's own provinces", () => {
  const owner = new Map<number, number>([
    [1, 10],
    [2, 20],
  ]);

  assert.equal(strokeActionFor(1, 10, owner, false), "erase", "already mine — a click removes it");
  assert.equal(strokeActionFor(2, 10, owner, false), "assign", "another country's — reassign");
  assert.equal(strokeActionFor(3, 10, owner, false), "assign", "unowned — assign");
  assert.equal(strokeActionFor(null, 10, owner, false), "assign", "the sea starts an assign");

  for (const id of [1, 2, 3, null]) {
    assert.equal(strokeActionFor(id, 10, owner, true), "erase", "alt always erases, id " + id);
  }
});
