import { flushGameTurn, loadGameTurn } from "../src/data-source/data-source.js";

const CURRENT_TURN = 4;

const main = async () => {
  const gameTurn = await loadGameTurn(CURRENT_TURN);

  for (const provinces of Object.values(gameTurn.provinces)) {
    provinces.supply = 5;
    provinces.fortress = 1;
  }

  await flushGameTurn(gameTurn);
};

void main();
