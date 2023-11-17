import { Game } from "@hw/project-may-game-model";

type TGameAppStartConfig = {
  guiRootNode: HTMLElement;
}

class GameAppService {
  start(config: TGameAppStartConfig) {
    const game = new Game(100, 100);

    /**
     * - create game instance and game service
     * - bind ws with lockstep sync
     * - setup input manager
     * - setup renderer
     * - setup GUI
     */
  }
}

export { GameAppService };
