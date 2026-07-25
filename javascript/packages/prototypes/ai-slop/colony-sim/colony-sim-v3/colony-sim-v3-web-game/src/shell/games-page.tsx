import { useState } from "preact/hooks";
import type { LobbyRoom } from "@hw/colony-sim-v3-protocol";
import { createRoom } from "./api";
import { lobbyError, rooms } from "./lobby";
import { OnlinePanel } from "./online-panel";
import { navigate, playPath, roomPath } from "./router";
import { requireSession } from "./session";

function playerCount(count: number): string {
  return count === 1 ? "1 player" : `${count} players`;
}

// The lobby list. It reads the mirrored `rooms` signal and never fetches: a room
// someone else created in another browser appears here without this page knowing
// anything happened.
function GamesPage() {
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const room = await createRoom(requireSession().playerId);
      navigate(roomPath(room.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not create the game");
    }
  };

  const open = (room: LobbyRoom) => {
    // A game already running has no waiting room left to show.
    navigate(room.started ? playPath(room.id) : roomPath(room.id));
  };

  return (
    <div className="shell">
      <header className="shell-head">
        <h1 className="shell-title">Active games</h1>
        <button type="button" className="shell-button" onClick={() => void create()}>
          create
        </button>
      </header>

      {lobbyError.value ? <p className="shell-error">{lobbyError.value}</p> : null}
      {error ? <p className="shell-error">{error}</p> : null}

      <div className="lobby-grid">
        {rooms.value.length === 0 ? (
          <p className="shell-empty">No games yet — create one.</p>
        ) : (
          <ul className="game-list">
            {rooms.value.map((room) => {
              return (
                <li key={room.id}>
                  <button type="button" className="game-card" onClick={() => open(room)}>
                    <span className="game-name">{room.name}</span>
                    <span className="game-meta">
                      {playerCount(room.players.length)}
                      {room.started ? " · in game" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <OnlinePanel />
      </div>
    </div>
  );
}

export { GamesPage };
