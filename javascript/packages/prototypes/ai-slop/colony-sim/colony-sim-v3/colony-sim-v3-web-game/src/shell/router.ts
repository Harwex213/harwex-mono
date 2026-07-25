import { signal } from "@preact/signals";

// Hash routing, not history routing: the app is served as a single static bundle
// with no server to rewrite deep links, and `#/games/x` survives a reload where
// `/games/x` would 404. The whole router is one signal — pages read it, nobody
// passes it down, and the game mount outside the Preact tree reads the same value.
type Route =
  | { name: "name" }
  | { name: "games" }
  | { name: "room"; gameId: string }
  | { name: "play"; gameId: string };

const NAME_PATH = "/";
const GAMES_PATH = "/games";

function roomPath(gameId: string): string {
  return `${GAMES_PATH}/${gameId}`;
}

function playPath(gameId: string): string {
  return `${roomPath(gameId)}/play`;
}

// Unknown paths fall back to the name gate rather than throwing: a stale link is a
// normal thing to open, and the gate is the one page that needs no other state.
function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (segments[0] !== "games") {
    return { name: "name" };
  }
  if (segments.length === 1) {
    return { name: "games" };
  }
  if (segments.length === 2) {
    return { name: "room", gameId: segments[1] };
  }
  if (segments.length === 3 && segments[2] === "play") {
    return { name: "play", gameId: segments[1] };
  }
  return { name: "games" };
}

const route = signal<Route>(parseRoute(globalThis.location.hash));

globalThis.addEventListener("hashchange", () => {
  route.value = parseRoute(globalThis.location.hash);
});

// Navigation goes through the hash, never by writing `route` directly: the address
// bar and the back button have to stay the source of truth, or the two disagree
// the first time someone hits Back.
function navigate(path: string): void {
  globalThis.location.hash = path;
}

export type { Route };
export { GAMES_PATH, NAME_PATH, navigate, playPath, roomPath, route };
