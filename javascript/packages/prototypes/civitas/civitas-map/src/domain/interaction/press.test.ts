import assert from "node:assert/strict";
import test from "node:test";
import { classifyPress } from "./press";

test("space or the middle button pans with any tool", () => {
  assert.deepEqual(classifyPress({ spaceHeld: true, button: 0, tool: "brush" }), { kind: "pan" });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 1, tool: "picker" }), { kind: "pan" });
});

test("buttons other than left, middle and right are ignored", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 3, tool: "brush" }), { kind: "ignore" });
});

test("the picker picks with either button", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, tool: "picker" }), { kind: "pick" });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, tool: "picker" }), { kind: "pick" });
});

test("the right button erases with the brush and the bucket", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, tool: "brush" }), { kind: "stroke", erasing: true });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, tool: "bucket" }), { kind: "fill", erasing: true });
});

test("the eraser erases with the left button", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, tool: "eraser" }), { kind: "stroke", erasing: true });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, tool: "brush" }), { kind: "stroke", erasing: false });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, tool: "bucket" }), { kind: "fill", erasing: false });
});
