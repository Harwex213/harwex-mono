import {
  BuildingKind,
  type BuildOrder,
  PLAYER_IDS,
  type PlayerId,
  type Position,
  RESOURCE_KINDS,
  SPAWN_KINDS,
  type SpawnKind,
  type WorldCommand,
} from "@hw/colony-sim-v1-core";
import type { WireCommand } from "@hw/colony-sim-v1-protocol";

// Turning what came off the socket back into a command the sim will accept.
//
// The server relays orders without reading them, which means the thing on the other end
// of this function is another build of the game — not a trusted caller. An order that
// does not typecheck at runtime is dropped, and dropping is safe for the one reason that
// matters here: every client is dropping the *same* order, because every client is
// checking the same bytes with the same code. A validator that let a malformed order
// through on one machine and rejected it on another would be the desync it is meant to
// prevent.
//
// The `owner` a command travelled with is ignored, and the sender's seat is used instead
// — the seat the server stamped the order with. Whose colony a colonist joins is not a
// field a client should be able to fill in.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A tile, and only a whole one. A fractional or out-of-range coordinate is not something
// the UI can produce, and `Math.floor` of a NaN is a tile at NaN.
function parseTile(value: unknown): Position | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y } = value;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: Math.floor(x as number), y: Math.floor(y as number) };
}

function parseBuildOrder(value: unknown): BuildOrder | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === BuildingKind.Farm) {
    return { kind: BuildingKind.Farm };
  }
  if (value.kind === BuildingKind.Warehouse) {
    const stores = RESOURCE_KINDS.find((kind) => kind === value.stores);
    return stores ? { kind: BuildingKind.Warehouse, stores } : null;
  }
  return null;
}

// One order, with the seat of whoever sent it. Returns null for anything unrecognised.
function parseCommand(command: WireCommand, owner: PlayerId): WorldCommand | null {
  if (!isRecord(command)) {
    return null;
  }
  if (command.type === "spawn") {
    const kind = SPAWN_KINDS.find((candidate) => candidate === command.kind) as SpawnKind | undefined;
    if (!kind) {
      return null;
    }
    // A spawn may legitimately name no tile — the sim then finds a free one, with the
    // world's own random stream, so every client picks the same tile.
    const tile = command.tile === null || command.tile === undefined ? null : parseTile(command.tile);
    if (command.tile !== null && command.tile !== undefined && !tile) {
      return null;
    }
    return { type: "spawn", kind, tile, owner };
  }
  if (command.type === "destroy") {
    // An id that is not in this world any more is not an error: it was picked a few turns
    // ago and something has happened to it since. The sim drops it.
    return Number.isInteger(command.id) ? { type: "destroy", id: command.id as number } : null;
  }
  if (command.type === "build") {
    const order = parseBuildOrder(command.order);
    const tile = parseTile(command.tile);
    return order && tile ? { type: "build", order, tile, owner } : null;
  }
  return null;
}

// Which colony a player runs: their index in the list the server pinned at start. The
// list is the same on every client and cannot change mid-game, which is what makes this
// a seat rather than a guess. A room with more players than the sim has colonies seats
// the extras with the first one — the same rule the lobby has always used.
function seatOfPlayer(players: readonly string[], playerId: string): PlayerId {
  const index = players.indexOf(playerId);
  return PLAYER_IDS[index] ?? PLAYER_IDS[0];
}

export { parseCommand, seatOfPlayer };
