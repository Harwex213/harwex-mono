import { render } from "preact";
import { clockOwned, DEFAULT_MAP_GEN, GameEngine, newGame, PLAYER_IDS } from "@hw/colony-sim-v1-core";
import { createGameStage } from "@hw/colony-sim-v1-game-render";
import { mountHud } from "@hw/colony-sim-v1-hud";
import { openGameSocket } from "../net/game-socket";
import { LockstepTurnSource } from "../net/lockstep";
import { resetNetStatus } from "../net/status";
import { seatOfPlayer } from "../net/wire";

// The shipped game: socket → world from the agreed seed → pixi stage → engine (owns the
// loop) → HUD over the canvas. The boot hands back a handle, because leaving the playing
// route has to stop the ticker and tear down the canvas instead of leaving a second one
// behind — and now also has to close the socket.
//
// Every game here is a networked one, a room of one included: the seed, the seats and the
// turn boundaries come from the same place either way, so there is no second boot path to
// keep in step with this one.
interface GameSession {
  destroy(): void;
}

async function bootGame(mount: HTMLElement, roomId: string, playerId: string): Promise<GameSession> {
  resetNetStatus();
  // First, because the terms of the match are in the reply and the world cannot be built
  // without them. It also starts the mailbox filling: turns arrive while pixi is still
  // loading, and they are kept rather than dropped — see game-socket.ts.
  const socket = await openGameSocket(roomId, playerId);

  // How many colonies the map is peopled with follows from how many players the server
  // pinned, so every client seeds the same crews onto the same terrain. The seat this
  // client *watches from* is its own index in that same list.
  const seats = PLAYER_IDS.slice(0, Math.max(1, socket.start.players.length));
  const world = newGame(socket.start.seed, DEFAULT_MAP_GEN, seats);
  // Built before the stage: from here turns are buffered against a world that exists, and
  // pixi's init no longer stands between them and it.
  const turns = new LockstepTurnSource(socket, world);
  clockOwned.value = socket.start.hostId === playerId;

  const stage = await createGameStage(mount);
  // No db, and this is the one thing multiplayer took away. A snapshot is one client's
  // world, and resuming it would mean every other client resuming the same turn from the
  // same bytes at the same moment — which is the rejoin feature this prototype does not
  // have. An autosave nothing may ever load is worse than none: it is a trap for whoever
  // reads this next.
  const engine = new GameEngine({
    world,
    db: null,
    player: seatOfPlayer(socket.start.players, playerId),
    createView: stage.createView,
    turns,
  });
  // The stage owns the clock the *renderer* runs on; what a frame means for the sim is now
  // the turn stream's answer.
  stage.onFrame((deltaMs) => engine.frame(deltaMs));
  engine.start();

  // The HUD needs a container of its own: it renders a Preact tree into whatever it
  // is given, and the shell's tree already lives in #app.
  const hudRoot = document.createElement("div");
  mount.appendChild(hudRoot);
  mountHud(engine, hudRoot);

  return {
    destroy: () => {
      engine.stop();
      socket.close();
      clockOwned.value = true;
      render(null, hudRoot);
      hudRoot.remove();
      stage.destroy();
    },
  };
}

export type { GameSession };
export { bootGame };
