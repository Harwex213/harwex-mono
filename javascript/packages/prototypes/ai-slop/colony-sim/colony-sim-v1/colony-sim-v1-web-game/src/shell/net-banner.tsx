import { desyncedAt, disconnected, waitingFor } from "../net/status";

// The one thing a networked game must never do silently: stop. A world with no turns
// coming looks exactly like a world where nothing is happening, and a desync looks like
// nothing at all — so both get said out loud, over the canvas, in the corner the HUD
// leaves free.
//
// It lives in the shell rather than in the hud package because it is about the connection,
// not about the colony: the hud speaks for a world and knows nothing of who else is
// watching it.
function NetBanner() {
  if (disconnected.value) {
    return <p className="net-banner net-banner-bad">connection lost — the game cannot continue</p>;
  }
  if (desyncedAt.value !== null) {
    return <p className="net-banner net-banner-bad">desync at turn {desyncedAt.value} — the worlds have parted</p>;
  }
  const waiting = waitingFor.value;
  if (waiting.length > 0) {
    return <p className="net-banner">waiting for {waiting.length} more player…</p>;
  }
  return null;
}

export { NetBanner };
