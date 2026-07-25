import type { LobbyEvent, SessionResponse } from "@hw/colony-sim-v1-protocol";

// Every call to the backend, and the only place in the client that knows a URL.
// Paths are relative: in dev the rspack server proxies /api to the backend, in
// production both are one origin — either way there is no host to configure and no
// CORS to arrange.
const API = "/api";

// The server answers errors with `{ error }`; surfacing that text beats a bare
// status code, because the pages show it to the player verbatim.
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload ? String(payload.error) : `request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function createSession(name: string): Promise<SessionResponse> {
  return post<SessionResponse>("/session", { name });
}

function createRoom(playerId: string): Promise<{ id: string }> {
  return post<{ id: string }>("/rooms", { playerId });
}

function joinRoom(roomId: string, playerId: string): Promise<void> {
  return post<void>(`/rooms/${roomId}/join`, { playerId });
}

function leaveRoom(roomId: string, playerId: string): Promise<void> {
  return post<void>(`/rooms/${roomId}/leave`, { playerId });
}

function startRoom(roomId: string, playerId: string): Promise<void> {
  return post<void>(`/rooms/${roomId}/start`, { playerId });
}

interface StreamHandlers {
  onLobby(event: LobbyEvent): void;
  onError(): void;
}

// The lobby's read path. EventSource reconnects by itself, so `onError` reports a
// gap rather than a death — the caller shows it and waits, it does not retry.
// Holding this connection open is also what keeps the player present on the server.
function openLobbyStream(playerId: string, handlers: StreamHandlers): () => void {
  const source = new EventSource(`${API}/stream?playerId=${encodeURIComponent(playerId)}`);
  source.onmessage = (message: MessageEvent<string>) => {
    const event: LobbyEvent = JSON.parse(message.data);
    handlers.onLobby(event);
  };
  source.onerror = () => handlers.onError();
  return () => source.close();
}

export { createRoom, createSession, joinRoom, leaveRoom, openLobbyStream, startRoom };
