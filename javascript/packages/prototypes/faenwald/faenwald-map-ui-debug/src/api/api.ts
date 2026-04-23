import type { TGameContext } from "@hw/faenwald-core";

const SERVER_URL = "http://localhost:3000";

const method = async <Params>(rpcMethod: string, params: Params) => {
  return fetch(`${SERVER_URL}/rpc`, {
    method: "POST",
    body: JSON.stringify({
      method: rpcMethod,
      params,
    }),
  })
};

export const loadGameContext = async (): Promise<TGameContext> => {
  const response = await method("gameContext.load", {});
  return response.json();
};

export const saveGameContext = async (gameContext: TGameContext): Promise<void> => {
  await method("gameContext.save", { gameContext });
};
