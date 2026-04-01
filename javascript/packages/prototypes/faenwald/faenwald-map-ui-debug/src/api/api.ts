import type { TGameTurn, TWarPhase } from "@hw/faenwald-core";

const SERVER_URL = "http://localhost:3000";

const method = async <Params>(rpcMethod: string, params: Params) => {
  return fetch(`${SERVER_URL}/rpc`, {
    method: "POST",
    body: JSON.stringify({
      method: rpcMethod,
      params,
    }),
  })
}

export const loadGameTurn = async (turn: number): Promise<TGameTurn> => {
  const response = await method("gameTurn.load", { turn });
  return response.json();
};

export const saveGameTurn = async (gameTurn: TGameTurn): Promise<void> => {
  await method("gameTurn.save", { gameTurn });
};

export const loadWarPhase = async (turn: number, phase: number): Promise<TWarPhase> => {
  const response = await method("warPhase.load", { turn, phase });
  return response.json();
};

export const saveWarPhase = async (turn: number, warPhase: TWarPhase): Promise<void> => {
  await method("warPhase.save", { warPhase, turn });
};
