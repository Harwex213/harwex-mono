import type { Route, RouteTree } from "./routes";

/**
 * Queueing on a shared road.
 *
 * Every parcel is one number: `remaining`, the arc length between it and the
 * castle. That single coordinate is what makes the ordering tractable. Two
 * parcels on the same road are at the same place exactly when their `remaining`
 * is equal, and because each intake lane is a tree — see `routes.ts` — two roads
 * of one lane that ever meet are identical from the meeting hex onwards. So
 * `remaining` is a shared coordinate on every stretch two parcels can possibly
 * share, and two parcels of different lanes share no stretch at all.
 *
 * One pass per frame, over the parcels sorted by `remaining`:
 *
 * - The parcel nearest the castle is looked at first and is never held up.
 * - Every other parcel finds its leader: the nearest parcel ahead of it whose
 *   road it shares. The leader has already been moved this frame, so the follower
 *   is measured against where the leader actually is, not against last frame.
 * - A door with a crate banked behind it counts as a leader too, so through
 *   traffic leaves a gap for the producer it is driving past.
 * - The follower may not come closer to its leader than `spacing`, and it may
 *   never move backwards. A parcel that is already too close — which happens the
 *   instant another parcel drops into the road ahead of it at a junction — holds
 *   still until the gap has opened instead of being shoved back down the road.
 *
 * `remaining` never increases, the sort is total (ties break on the ascending
 * parcel id) and nothing reads a clock, so a given set of parcels and a given
 * time step always produce the same result.
 */

type Traveller = {
  /** Ascending, never reused. The tie-break that makes the ordering total. */
  id: number;
  route: Route;
  /** Arc length left to the castle. Only ever falls. */
  remaining: number;
};

/**
 * A crate waiting inside a producer for room on the road.
 *
 * It is not a parcel: it never moves and it is never drawn. It is put into the
 * queue at the producer's door so that traffic coming down the road behind the
 * door has to leave a gap for it, exactly as it would for a crate already out.
 *
 * Without it, through traffic has absolute priority over a doorway. A road
 * carrying its full load has no gap of a whole spacing anywhere in it, so a
 * producer standing on somebody else's road is refused every frame for as long
 * as that road is busy — which is the stall the player watched pile up to the
 * cap. With it and nothing else the priority is simply the other way round, and
 * the producers further up the road are the ones that never get in. Which is why
 * the caller only hands a door in once it has let a spacing of traffic past
 * since its last crate went out; see `loadOut` in `state/parcels.ts`.
 */
type Gate = {
  route: Route;
  /** Arc length of the door, which is `route.length`. */
  remaining: number;
};

/**
 * Whether `ahead` is in `behind`'s way.
 *
 * Two parcels on separate branches of the forest are simply not on the same
 * road, however close their `remaining` values happen to be, and holding one for
 * the other would read as an unexplained stall. They start to matter to each
 * other once the leader is near the hex where the two roads join: from there on
 * the follower is aiming at ground the leader is standing on.
 *
 * `lookahead` is how far before that junction the two start to matter, as a
 * multiple of the spacing. One would be enough to keep them apart along the
 * road. It is not enough to keep them apart on screen: two roads can meet at a
 * shallow angle — the hex grid squashed onto this camera has pairs of directions
 * only 38° apart — and two parcels a spacing apart along their own roads can be
 * two thirds of that apart in the picture. Ordering them a few spacings before
 * the junction is what turns a near miss into a merge.
 */
function inTheWay(
  tree: RouteTree,
  ahead: Traveller,
  behind: Traveller,
  spacing: number,
  lookahead: number,
): boolean {
  return ahead.remaining <= tree.mergeRemaining(ahead.route, behind.route) + spacing * lookahead;
}

/**
 * Whether the crate waiting at `gate` is in `behind`'s way.
 *
 * Two conditions on top of the ordinary one. The gate only holds traffic that is
 * still a clear spacing short of the door, which is what keeps the rule free of
 * deadlock: a parcel that is already inside the door's spacing is waved through
 * rather than pinned there, and pinning it there is precisely what would stop
 * the door from ever opening. And the gate never holds a parcel that is level
 * with it or past it, because that parcel came out of this very door.
 */
function gateInTheWay(
  tree: RouteTree,
  gate: Gate,
  behind: Traveller,
  spacing: number,
  lookahead: number,
): boolean {
  if (behind.remaining < gate.remaining + spacing) {
    return false;
  }
  return gate.remaining <= tree.mergeRemaining(gate.route, behind.route) + spacing * lookahead;
}

/**
 * Moves every parcel one step and returns them ordered from the castle
 * outwards. The returned array is a fresh one; the parcels in it are the
 * caller's own objects, moved in place.
 *
 * `gates` are the doors with a crate waiting behind them. They are read only,
 * never moved, and never appear in the result.
 */
function advanceTravellers(
  travellers: readonly Traveller[],
  tree: RouteTree,
  seconds: number,
  speed: number,
  spacing: number,
  lookahead: number,
  gates: readonly Gate[] = [],
): Traveller[] {
  const order = [...travellers].sort((left, right) => left.remaining - right.remaining || left.id - right.id);
  const step = speed * seconds;
  for (let index = 0; index < order.length; index += 1) {
    const self = order[index]!;
    const wanted = self.remaining - step;
    let limit = Number.NEGATIVE_INFINITY;
    // The list is sorted, so the first parcel found walking back towards the
    // castle is the nearest leader there is, and its limit is the tightest.
    for (let ahead = index - 1; ahead >= 0; ahead -= 1) {
      const leader = order[ahead]!;
      if (!inTheWay(tree, leader, self, spacing, lookahead)) {
        continue;
      }
      limit = leader.remaining + spacing;
      break;
    }
    // A waiting door counts too, and the tightest of the two wins. There are at
    // most as many gates as there are producers, and only the ones with a crate
    // banked are handed in at all.
    for (const gate of gates) {
      if (gate.remaining + spacing <= limit) {
        continue;
      }
      if (!gateInTheWay(tree, gate, self, spacing, lookahead)) {
        continue;
      }
      limit = gate.remaining + spacing;
    }
    self.remaining = Math.max(wanted, Math.min(self.remaining, limit));
  }
  return order;
}

/**
 * Whether a fresh parcel may be set down at the start of `route` without
 * landing inside the spacing of one that is already on the road.
 *
 * The producer asks before it loads a crate out, which is what keeps the
 * spacing true at the one moment the queue itself cannot enforce it: a parcel
 * appearing out of nothing. A road that is backed up to the shed door holds the
 * next crate inside the shed instead.
 *
 * The test is the bare spacing, deliberately without the merge lookahead the
 * queue uses. The lookahead is a rule about who slows down for whom; applied to
 * a doorway it becomes a rule about who is allowed to exist, and a producer
 * standing on another producer's road would be starved by traffic that is still
 * two hexes away and about to pass.
 */
function roomAtStart(
  tree: RouteTree,
  route: Route,
  travellers: readonly Traveller[],
  spacing: number,
): boolean {
  const door = route.length;
  for (const other of travellers) {
    if (Math.abs(other.remaining - door) >= spacing) {
      continue;
    }
    // Anything whose own road does not run past this door is on another branch,
    // and a branch is somewhere else on the island.
    if (tree.mergeRemaining(other.route, route) >= door) {
      return false;
    }
  }
  return true;
}

export type { Gate, Traveller };
export { advanceTravellers, roomAtStart };
