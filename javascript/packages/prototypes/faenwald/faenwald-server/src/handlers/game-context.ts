import type { TGameContext } from "@hw/faenwald-core";
import { register } from "../core/rpc.js";
import { RpcError } from "../core/error.js";
import { flushGameContext, loadGameContext } from "../data-source/data-source.js";

type LoadParams = {};
type SaveParams = { gameContext: TGameContext };

const loadGameContextHandler = loadGameContext;
register<LoadParams, TGameContext>("gameContext.load", loadGameContextHandler);

const saveGameContextHandler = async (params: SaveParams) => {
  if (!params?.gameContext || params.gameContext.allTurnsValid !== true) {
    throw new RpcError("INVALID_PARAMS", "\"gameContext\" with a \"allTurnsValid\" equals to `true` is required");
  }

  await flushGameContext(params.gameContext);
};
register<SaveParams, void>("gameContext.save", saveGameContextHandler);

export { loadGameContextHandler };
