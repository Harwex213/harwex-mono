import { leaveRoom } from "./api";
import { NamePage } from "./name-page";
import { GamesPage } from "./games-page";
import { RoomPage } from "./room-page";
import { GAMES_PATH, navigate, route } from "./router";
import { requireSession, session } from "./session";

// The routed part of the app — and only that part. The playing route draws no page
// here: the canvas and its HUD are mounted outside this tree (see main.tsx), because
// the game loop must not hang off a component's lifecycle. All that is left over the
// canvas is the way back out, in the one corner the HUD does not use.
function App() {
  const current = route.value;
  const signedIn = session.value !== null;

  // Every page below the gate assumes a session, and the session is in memory: a
  // reload lands on any URL with none. So the gate wins over the route, rather than
  // each page defending itself.
  if (!signedIn) {
    return <NamePage />;
  }

  if (current.name === "play") {
    return (
      <button
        type="button"
        className="shell-button leave-game"
        onClick={() => {
          // Walking out of the game is also walking out of the room. Without this the
          // player stays listed in a game they are no longer in, until the tab closes
          // and the stream takes them out.
          void leaveRoom(current.gameId, requireSession().playerId);
          navigate(GAMES_PATH);
        }}
      >
        ← games
      </button>
    );
  }

  switch (current.name) {
    case "games":
      return <GamesPage />;
    case "room":
      return <RoomPage gameId={current.gameId} />;
    default:
      return <NamePage />;
  }
}

export { App };
