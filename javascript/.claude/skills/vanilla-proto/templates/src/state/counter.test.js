import test from "node:test";
import assert from "node:assert/strict";
import { addCount, createInitialState } from "./counter.js";

test("addCount adds delta", () => {
  const s = createInitialState();
  addCount(s, 2);
  assert.equal(s.count, 2);
});
