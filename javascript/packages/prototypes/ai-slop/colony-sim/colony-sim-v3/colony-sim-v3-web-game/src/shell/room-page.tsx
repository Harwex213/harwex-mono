import { useEffect, useRef, useState } from "preact/hooks";
import { joinRoom, leaveRoom, startRoom } from "./api";
import { rooms } from "./lobby";
import { GAMES_PATH, navigate, playPath } from "./router";
import { requireSession } from "./session";

interface RoomPageProps {
  gameId: string;
}

// The waiting room. Everything it shows comes from the server's snapshot, so a
// player joining from another browser appears in the list, and the host pressing
// start moves everyone here into the game at once — nobody polls, and nobody has to
// be told twice.
function RoomPage({ gameId }: RoomPageProps) {
  const { playerId } = requireSession();
  const room = rooms.value.find((candidate) => candidate.id === gameId) ?? null;
  const [error, setError] = useState<string | null>(null);

  // Leaving on unmount must not fire when the unmount is us walking into the game.
  // The cleanup closure captures its render's values, so the current answer has to
  // reach it through a ref.
  const started = useRef(false);
  started.current = room?.started ?? false;

  // Joining happens here rather than in whatever linked here, so a pasted room URL
  // behaves exactly like a click from the list. Both calls are idempotent on the
  // server.
  useEffect(() => {
    void joinRoom(gameId, playerId).catch(() => setError("could not join this game"));
    return () => {
      if (!started.current) {
        void leaveRoom(gameId, playerId);
      }
    };
  }, [gameId, playerId]);

  // The host started it. This is the only thing that moves a guest into the game.
  useEffect(() => {
    if (room?.started) {
      navigate(playPath(gameId));
    }
  }, [gameId, room?.started]);

  if (!room) {
    // Either a stale link, or the last player left and the room went with them.
    return (
      <div className="shell">
        <header className="shell-head">
          <h1 className="shell-title">Game not found</h1>
          <button type="button" className="shell-button" onClick={() => navigate(GAMES_PATH)}>
            back
          </button>
        </header>
      </div>
    );
  }

  const isHost = room.hostId === playerId;

  return (
    <div className="shell">
      <div className="room">
        <ul className="player-list">
          {room.players.map((player) => {
            return (
              <li key={player.id} className="player-card">
                {player.name}
                {player.id === room.hostId ? <span className="player-tag">host</span> : null}
              </li>
            );
          })}
        </ul>
        {isHost ? (
          <button
            type="button"
            className="shell-button"
            onClick={() => {
              setError(null);
              void startRoom(gameId, playerId).catch(() => setError("could not start the game"));
            }}
          >
            start
          </button>
        ) : (
          <p className="shell-waiting">waiting for the host…</p>
        )}
      </div>
      {error ? <p className="shell-error">{error}</p> : null}
    </div>
  );
}

export { RoomPage };
