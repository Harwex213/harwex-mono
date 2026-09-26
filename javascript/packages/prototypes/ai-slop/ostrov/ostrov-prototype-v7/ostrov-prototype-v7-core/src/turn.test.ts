import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Turn } from "./turn";

test("a turn walks the four phases of the core loop", () => {
  const turn = new Turn();

  strictEqual(turn.phase.value, "building");
  strictEqual(turn.next(), "taxes");
  strictEqual(turn.next(), "scouting");
  strictEqual(turn.next(), "cleanup");
  strictEqual(turn.next(), "building");
});

test("the number grows when the loop closes", () => {
  const turn = new Turn();

  strictEqual(turn.number.value, 1);

  turn.next();
  turn.next();
  turn.next();

  strictEqual(turn.number.value, 1);

  turn.next();

  strictEqual(turn.number.value, 2);
});
