export const GAME_CONFIG = {
  map: {
    width: 40,      // grid columns
    height: 30,     // grid rows
    cellSize: 20,   // pixels per cell
  },
  initialUnits: {
    player: {
      leader: 1,
      cavalry: 3,
      infantry: 5,
      archer: 5,
    },
    enemy: {
      cavalry: 3,
      infantry: 4,
      archer: 4,
    },
  },
  spawn: {
    playerX: 5,   // starting X position for player units
    enemyX: 35,   // starting X position for enemy units
    spreadY: 3,   // vertical spacing between units
  },
};
