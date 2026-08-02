import type { World } from "./world";

// A fingerprint of the whole mutable world, for lockstep to check itself with.
//
// Determinism is not something a design can promise — one implementation-approximated
// `Math.hypot`, one Map iterated in a different insertion order, and two clients drift
// apart in a way that looks like nothing at all for a minute and then like two
// different games. The only defence is to compare, out loud, every few turns: the
// clients hash the same turn and the server says whether the numbers agree.
//
// What is hashed is everything a system can read, in the order a system would read it
// — insertion order, not sorted ids. That is deliberate: two worlds with the same
// contents in a different order are already broken, because the next tick's iteration
// will hand the same job to different colonists. Sorting would hide exactly the bug
// this is here to find.
//
// Excluded: `prevPositions` (rebuilt from positions every step, for the renderer's
// lerp only) and `grid.terrain`/`region` (written once by mapgen, never by a tick — a
// mismatch there is a mapgen desync, and it shows up in positions within a tick
// anyway).

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// One float64, viewed as its two words: hashing `value | 0` would call 1.5 and 1.4999
// the same number, and the whole point is that the last bit matters.
const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);

function mix(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (value >>> shift) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function mixFloat(hash: number, value: number): number {
  bits[0] = value;
  return mix(mix(hash, words[0]), words[1]);
}

// The string unions (a resource kind, a seat) go in whole. Hashing their length would
// call "wood" and "food" the same thing, which is the one confusion a warehouse
// readout would show and this check would miss.
function mixText(hash: number, value: string | null): number {
  if (value === null) {
    return mix(hash, 0xffffffff);
  }
  let h = mix(hash, value.length);
  for (let i = 0; i < value.length; i += 1) {
    h = mix(h, value.charCodeAt(i));
  }
  return h;
}

function hashWorld(world: World): number {
  let h = FNV_OFFSET;
  h = mix(h, world.tick);
  h = mix(h, world.nextId);
  h = mix(h, world.rngState);

  for (const id of world.entities) {
    h = mix(h, id);
  }
  for (const [id, pos] of world.positions) {
    h = mixFloat(mixFloat(mix(h, id), pos.x), pos.y);
  }
  for (const [id, owner] of world.owners) {
    h = mixText(mix(h, id), owner);
  }
  for (const [id, needs] of world.needs) {
    h = mixFloat(mixFloat(mix(h, id), needs.hunger), needs.fatigue);
  }
  for (const [id, path] of world.paths) {
    h = mixFloat(mix(mix(mix(h, id), path.index), path.waypoints.length), path.speed);
    // The whole route, not just where along it the walker is: two colonists heading
    // for the same tile by different paths will be standing in different places three
    // ticks from now, and this is the turn on which that is still cheap to notice.
    for (const waypoint of path.waypoints) {
      h = mix(mix(h, waypoint.x), waypoint.y);
    }
  }
  for (const [id, job] of world.jobs) {
    h = mixFloat(mix(mix(mix(h, id), job.kind), job.targetId ?? -1), job.progress);
    h = job.targetTile === null ? mix(h, -1) : mix(mix(h, job.targetTile.x), job.targetTile.y);
  }
  for (const [id, inventory] of world.inventories) {
    h = mixText(mix(mix(h, id), inventory.amount), inventory.kind);
  }
  for (const [id, animal] of world.animals) {
    h = mix(mix(mix(h, id), animal.kind), animal.idleTicks);
  }
  for (const [id, item] of world.items) {
    h = mixText(mix(mix(h, id), item.amount), item.kind);
  }
  for (const [id, building] of world.buildings) {
    h = mix(mix(mix(mix(h, id), building.kind), building.amount), building.growth);
    h = mixText(h, building.stores);
  }
  for (const id of world.trees) {
    h = mix(h, id);
  }
  for (const id of world.rocks) {
    h = mix(h, id);
  }
  // Occupancy is derived from the buildings, but it is what A* reads: a bit that
  // disagreed would route two clients' colonists around opposite sides of a hut.
  for (let i = 0; i < world.grid.blocked.length; i += 1) {
    if (world.grid.blocked[i] !== 0) {
      h = mix(h, i);
    }
  }
  return h >>> 0;
}

export { hashWorld };
