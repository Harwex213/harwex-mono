import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVeto, resolveAction } from "./veto.ts";
import type { TAction, TFormat, TSide } from "./veto.ts";

const play = (format: TFormat, firstSide: TSide, maps: string[]) => {
  const actions: TAction[] = [];
  for (const map of maps) {
    const veto = computeVeto(format, firstSide, actions);
    const action = resolveAction(veto, veto.next!.side, map);
    if (typeof action === "string") {
      throw new Error(action);
    }
    actions.push(action);
  }
  return { actions, veto: computeVeto(format, firstSide, actions) };
};

test("waits for the coin toss", () => {
  assert.equal(computeVeto("bo1", null, []).phase, "waiting");
});

test("bo1 alternates seven bans and leaves the decider", () => {
  const { actions, veto } = play("bo1", "b", ["dust2", "mirage", "inferno", "cache", "overpass", "train", "office"]);
  assert.deepEqual(actions.map((action) => action.side), ["b", "a", "b", "a", "b", "a", "b"]);
  assert.ok(actions.every((action) => action.kind === "ban"));
  assert.equal(veto.phase, "done");
  assert.equal(veto.decider, "nuke");
  assert.deepEqual(veto.playOrder, ["nuke"]);
});

test("bo3 runs ban ban pick pick ban ban ban", () => {
  const { actions, veto } = play("bo3", "a", ["dust2", "mirage", "inferno", "cache", "overpass", "train", "office"]);
  assert.deepEqual(actions.map((action) => action.kind), ["ban", "ban", "pick", "pick", "ban", "ban", "ban"]);
  assert.deepEqual(veto.playOrder, ["inferno", "cache", "nuke"]);
});

test("rejects a move out of turn and a used map", () => {
  const { veto } = play("bo1", "a", ["dust2"]);
  assert.equal(resolveAction(veto, "a", "mirage"), "Сейчас ход соперника");
  assert.equal(resolveAction(veto, "b", "dust2"), "Эта карта уже недоступна");
});
