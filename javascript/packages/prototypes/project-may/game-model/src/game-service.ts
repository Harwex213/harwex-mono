import type { Game } from "./game";

const GAME_ACTION_TYPE = {
  TICK: 0,

  UNIT_MOVE: 1000,
  UNIT_SPAWN: 1001,
};

type TGameAction = {
  type: number;
  props: any;
}

const applyActionFactory = (game: Game) => {
  // TODO: all public methods of game could be just linked to game action types
  const actionMap = {
    [GAME_ACTION_TYPE.UNIT_MOVE]: game.moveUnit.bind(game),
    [GAME_ACTION_TYPE.UNIT_SPAWN]: game.spawnUnit.bind(game),
  };

  return (action: TGameAction) => {
    if (typeof action.props !== "object" || typeof action.props === "function") {
      // TODO: error

      return;
    }

    const handler = actionMap[action.type];
    if (handler) {
      handler(action.props);
    }
  };
};

export { applyActionFactory };
