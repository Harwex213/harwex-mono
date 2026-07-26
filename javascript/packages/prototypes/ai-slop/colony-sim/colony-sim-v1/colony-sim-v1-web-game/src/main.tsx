import "./styles/reset.css";
import "./styles/shell.css";
import { effect } from "@preact/signals";
import { render } from "preact";
import { bootGame, type GameSession } from "./game/boot";
import { App } from "./shell/App";
import { GAMES_PATH, navigate, route } from "./shell/router";
import { session } from "./shell/session";

// Two roots on purpose. #app holds the routed Preact tree — name gate, lobby, room.
// #game holds the canvas and the HUD over it, and is driven from here rather than
// from a component: the loop belongs to the engine singleton, and hanging its
// creation on a component's lifecycle is exactly the trap this package avoids.
// Both live under one route signal, so they can never show two different screens.
function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`#${id} mount point missing`);
  }
  return element;
}

const gameRoot = requireElement("game");

let running: GameSession | null = null;
let mountedGameId: string | null = null;
// pixi's init is async, so a route change can land mid-boot. Every boot carries the
// generation it was started in and throws itself away if it is no longer wanted.
let generation = 0;

effect(() => {
  const current = route.value;
  const wanted = current.name === "play" ? current.gameId : null;
  if (wanted === mountedGameId) {
    return;
  }
  mountedGameId = wanted;
  generation += 1;
  const started = generation;

  running?.destroy();
  running = null;
  if (!wanted) {
    return;
  }

  // Non-reactive reads: this effect follows the route, not the lobby or the session.
  // A deep link into a game lands here with no session — it lives in memory and did not
  // survive the reload — and the shell's gate takes it from the lobby.
  const me = session.peek();
  if (!me) {
    mountedGameId = null;
    navigate(GAMES_PATH);
    return;
  }

  // The room is not consulted for anything the game needs: the seed, the seats and the
  // turn boundaries all come from the game session on the server, over the socket. That
  // is what makes this a shared world rather than two worlds built from one number — and
  // it is also the only place that can refuse, which a room snapshot in a client's memory
  // could not.
  void bootGame(gameRoot, wanted, me.playerId)
    .then((booted) => {
      if (generation !== started) {
        booted.destroy();
        return;
      }
      running = booted;
    })
    .catch(() => {
      // No session for this room: it was never started, it has ended, or this player is
      // not one of its seats — a reload is the usual way, since it comes back as a new
      // player the game has never heard of. The lobby is where that gets sorted out.
      if (generation === started) {
        mountedGameId = null;
        navigate(GAMES_PATH);
      }
    });
});

render(<App />, requireElement("app"));
