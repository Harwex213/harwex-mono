import type { Route, RouteTree } from "./routes";

/**
 * Queueing on a shared road.
 *
 * Every parcel is one number: `remaining`, the arc length between it and the
 * castle. That single coordinate is what makes the ordering tractable. Two
 * parcels on the same road are at the same place exactly when their `remaining`
 * is equal, and because the roads form a tree — see `routes.ts` — two roads that
 * ever meet are identical from the meeting hex onwards. So `remaining` is a
 * shared coordinate on every stretch two parcels can possibly share.
 *
 * One pass per frame, over the parcels sorted by `remaining`:
 *
 * - The parcel nearest the castle is looked at first and is never held up.
 * - Every other parcel finds its leader: the nearest parcel ahead of it whose
 *   road it shares. The leader has already been moved this frame, so the follower
 *   is measured against where the leader actually is, not against last frame.
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
 * How far before a junction two parcels on different roads start to matter to
 * each other, as a multiple of the spacing.
 *
 * One would be enough to keep them apart along the road. It is not enough to
 * keep them apart on screen: two roads can meet at a shallow angle — the hex
 * grid squashed onto this camera has pairs of directions only 38° apart — and
 * two parcels a spacing apart along their own roads can be two thirds of that
 * apart in the picture. Ordering them a few spacings before the junction is what
 * turns a near miss into a merge: the two queues interleave on approach instead
 * of arriving abreast.
 */
const MERGE_LOOKAHEAD = 2.5;

/**
 * Whether `ahead` is in `behind`'s way.
 *
 * Two parcels on separate branches of the tree are simply not on the same road,
 * however close their `remaining` values happen to be, and holding one for the
 * other would read as an unexplained stall. They start to matter to each other
 * once the leader is near the hex where the two roads join: from there on the
 * follower is aiming at ground the leader is standing on.
 */
function inTheWay(tree: RouteTree, ahead: Traveller, behind: Traveller, spacing: number): boolean {
  return ahead.remaining <= tree.mergeRemaining(ahead.route, behind.route) + spacing * MERGE_LOOKAHEAD;
}

/**
 * Moves every parcel one step and returns them ordered from the castle
 * outwards. The returned array is a fresh one; the parcels in it are the
 * caller's own objects, moved in place.
 */
function advanceTravellers(
  travellers: readonly Traveller[],
  tree: RouteTree,
  seconds: number,
  speed: number,
  spacing: number,
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
      if (!inTheWay(tree, leader, self, spacing)) {
        continue;
      }
      limit = leader.remaining + spacing;
      break;
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

export type { Traveller };
export { advanceTravellers, roomAtStart };
