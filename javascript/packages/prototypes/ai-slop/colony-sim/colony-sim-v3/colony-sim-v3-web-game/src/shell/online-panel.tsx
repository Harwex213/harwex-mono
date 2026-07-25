import { onlinePlayers, rooms } from "./lobby";
import { session } from "./session";

// Who else is here. It answers the question the lobby list cannot: an empty list of
// games with three people standing in it means something different from an empty
// list with nobody in it.
//
// Where each player is comes from the rooms, not from a second field on the player:
// membership already lives in one place, and a copy on the player would be the thing
// that goes stale.
function OnlinePanel() {
  const here = onlinePlayers.value;
  const me = session.value?.playerId;

  const roomOf = new Map<string, string>();
  for (const room of rooms.value) {
    for (const player of room.players) {
      roomOf.set(player.id, room.started ? "in game" : "waiting");
    }
  }

  return (
    <aside className="online">
      <h2 className="shell-subtitle">Online · {here.length}</h2>
      <ul className="online-list">
        {here.map((player) => {
          return (
            <li key={player.id} className="online-row">
              <span className="online-name">
                {player.name}
                {player.id === me ? " (you)" : ""}
              </span>
              <span className="online-where">{roomOf.get(player.id) ?? "in lobby"}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export { OnlinePanel };
