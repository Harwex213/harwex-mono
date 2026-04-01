import type { TGameTurn } from "@hw/faenwald-core";
import { register } from "../core/rpc.js";
import { RpcError } from "../core/error.js";
import { loadGameTurn, flushGameTurn } from "../data-source/data-source.js";

type LoadParams = { turn: number };
type SaveParams = { gameTurn: TGameTurn };

register<LoadParams, TGameTurn>("gameTurn.load", async (params) => {
  if (typeof params?.turn !== "number") {
    throw new RpcError("INVALID_PARAMS", "\"turn\" must be a number");
  }

  return loadGameTurn(params.turn);
});

register<SaveParams, void>("gameTurn.save", async (params) => {
  if (!params?.gameTurn || typeof params.gameTurn.turn !== "number") {
    throw new RpcError("INVALID_PARAMS", "\"gameTurn\" with a valid \"turn\" is required");
  }

  await flushGameTurn(params.gameTurn);
});
