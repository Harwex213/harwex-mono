import { Game } from "./game";

/**
 * One game per page. The panels call commands on it directly; the canvas owns
 * the frame loop. Restarting swaps the world inside the same instance, so no
 * component has to re-subscribe.
 */
const game = new Game(Math.floor(Math.random() * 1_000_000_000));

// Debug handle: a browser tab that is not visible gets no animation frames, so
// the console needs a way to step the simulation by hand.
(window as unknown as { ostrov: Game }).ostrov = game;

export { game };
