import assert from "node:assert/strict";
import test from "node:test";
import { classifyPress } from "./press";

test("space or the middle button pans with any tool", () => {
  assert.deepEqual(classifyPress({ spaceHeld: true, button: 0, altKey: false, mode: "provinces", tool: "brush" }), { kind: "pan" });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 1, altKey: false, mode: "provinces", tool: "picker" }), { kind: "pan" });
});

test("buttons other than left, middle and right are ignored", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 3, altKey: false, mode: "provinces", tool: "brush" }), { kind: "ignore" });
});

test("the picker picks with either button", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, altKey: false, mode: "provinces", tool: "picker" }), { kind: "pick" });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, altKey: false, mode: "provinces", tool: "picker" }), { kind: "pick" });
});

test("the right button erases with the brush and the bucket", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, altKey: false, mode: "provinces", tool: "brush" }), { kind: "stroke", erasing: true });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 2, altKey: false, mode: "provinces", tool: "bucket" }), { kind: "fill", erasing: true });
});

test("the eraser erases with the left button", () => {
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, altKey: false, mode: "provinces", tool: "eraser" }), { kind: "stroke", erasing: true });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, altKey: false, mode: "provinces", tool: "brush" }), { kind: "stroke", erasing: false });
  assert.deepEqual(classifyPress({ spaceHeld: false, button: 0, altKey: false, mode: "provinces", tool: "bucket" }), { kind: "fill", erasing: false });
});

test("the countries mode assigns with the left button and takes out with the right button or Alt", () => {
  const press = (button: number, altKey: boolean) => {
    return classifyPress({ spaceHeld: false, button, altKey, mode: "countries", tool: "bucket" });
  };

  assert.deepEqual(press(0, false), { kind: "countryStroke", erasing: false });
  assert.deepEqual(press(2, false), { kind: "countryStroke", erasing: true });
  assert.deepEqual(press(0, true), { kind: "countryStroke", erasing: true });
  assert.deepEqual(press(1, false), { kind: "pan" });
  assert.deepEqual(classifyPress({ spaceHeld: true, button: 0, altKey: false, mode: "countries", tool: "brush" }), { kind: "pan" });
});
