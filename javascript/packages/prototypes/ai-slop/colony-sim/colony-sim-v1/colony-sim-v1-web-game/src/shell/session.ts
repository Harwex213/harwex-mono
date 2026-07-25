import { signal } from "@preact/signals";
import type { SessionResponse } from "@hw/colony-sim-v1-protocol";
import { createSession } from "./api";
import { connectLobby } from "./lobby";

// Who is playing — in memory, and nowhere else. The server issues the id and holds
// the player only for as long as their event stream is open, so persisting it here
// would just mean starting up with a handle the server has already forgotten. A
// reload is a new session, and the name gate is where it begins.
const session = signal<SessionResponse | null>(null);

async function signIn(name: string): Promise<void> {
  const next = await createSession(name);
  session.value = next;
  // Signing in and being present are the same act: the stream both delivers the
  // lobby and keeps the player in it.
  connectLobby(next.playerId);
}

// The id, for the callers that cannot proceed without one. Every page below the
// gate has a session by construction, so this throwing means a routing bug, not a
// state a player can reach.
function requireSession(): SessionResponse {
  const current = session.peek();
  if (!current) {
    throw new Error("no session");
  }
  return current;
}

export { requireSession, session, signIn };
