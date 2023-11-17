import { GameAppService } from "./game-app/game-app-service";
import { launchWsConnection } from "./ws-connection/ws-connection";

const startAppService = () => {
  const gameApp = new GameAppService();

  gameApp.start({
    guiRootNode: document.body,
  });

  // TODO: change state of current app
};

const main = () => {
  startAppService();
  launchWsConnection();
};

main();
