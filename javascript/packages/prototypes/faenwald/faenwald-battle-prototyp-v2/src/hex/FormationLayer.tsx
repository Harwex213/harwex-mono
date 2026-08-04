import type { FormationLink } from "../state/formations";
import { HEX_EDGE, sharedEdge } from "./hex-layout";
import styles from "./formation.module.css";

// The chain is drawn along the shared edge, and stops short of both ends of it:
// three hexes meet at a hex corner, so a chain running the whole way would touch
// the chains on the two edges either side of it and the three would read as one
// tangle rather than as three separate pairs.
const CHAIN_INSET = 4;

const CHAIN_SPAN = HEX_EDGE - 2 * CHAIN_INSET;

// How many links that span is filled with. Five is enough for the chain to read
// as a chain at the zoom the canvas fits the grid to, without the links being so
// fine that they disappear.
const LINK_COUNT = 5;

const LINK_PITCH = CHAIN_SPAN / LINK_COUNT;

// Half the length of a link, measured along the chain. Over half the pitch, so a
// link reaches into both its neighbours: that overlap is the whole of what makes
// the row read as one chain rather than as a line of separate rings. Not much
// over, though — a link long enough to reach the middle of its neighbour covers
// most of it, and a covered link is a notch rather than a ring.
const LINK_RX = LINK_PITCH * 0.68;

// Half the width of a link, measured across the chain. A chain alternates between
// links lying flat and links standing on edge, and a standing link is the same
// ring seen the narrow way — so both halves of the pattern are one shape at two
// widths. The narrow one has to stay wide enough to keep a hole in it: a standing
// link drawn thinner than the line it is drawn with is a dark bar, and a row of
// ovals with bars between them is not a chain.
const LINK_RY_FLAT = LINK_PITCH * 0.42;

const LINK_RY_STANDING = LINK_PITCH * 0.25;

type ChainLink = {
  // Distance along the chain from its middle.
  x: number;
  standing: boolean;
};

// Every other link stands on edge. The flat ones are drawn first and the standing
// ones over them, so a standing link is a whole unbroken ring crossing the two
// flat links it is threaded between — which is what says "chain" rather than "row
// of rings". The other way round the standing links come out mostly buried, and
// what is left of one reads as a notch where two ovals meet.
const CHAIN_LINKS: ChainLink[] = Array.from({ length: LINK_COUNT }, (_unused, index) => ({
  x: -CHAIN_SPAN / 2 + LINK_PITCH * (index + 0.5),
  standing: index % 2 === 1,
})).sort((first, second) => Number(first.standing) - Number(second.standing));

// The chains between spearmen holding a closed formation, one per pair. A chain
// runs along the border the two units share, which is the middle of the gap
// between their hexes — so it belongs to the pair rather than to either unit, and
// neither marker has to give up any of its own hex to it.
//
// Nothing is animated. A formation is a state the two units are standing in, not
// something the board is waiting on: the marching border of a canopy cone says
// "this is live", and a chain saying the same thing would be a second answer to a
// question nobody asked.
//
// Nothing here takes the pointer either. The chain is drawn in the gap, where no
// hex answers a click anyway, and a chain that swallowed the pointer would make a
// hex harder to hover the closer the pointer came to a formation.
function FormationLayer({ links }: { links: FormationLink[] }) {
  return (
    <>
      {links.map((link) => (
        <FormationChain key={link.key} link={link} />
      ))}
    </>
  );
}

function FormationChain({ link }: { link: FormationLink }) {
  const edge = sharedEdge(link.col, link.row, link.direction);
  if (edge === null) {
    return null;
  }

  const [from, to] = edge;

  // The chain is laid out along its own x axis and then turned onto the edge, so
  // the link arithmetic above is the same for all six directions a formation can
  // run in.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

  return (
    <g
      className={styles.chain}
      transform={`translate(${midX.toFixed(2)} ${midY.toFixed(2)}) rotate(${degrees.toFixed(2)})`}
    >
      {CHAIN_LINKS.map((chainLink) => (
        <ChainRing key={chainLink.x} link={chainLink} />
      ))}
    </g>
  );
}

// One link: the ring itself, and a darker, wider ring under it. The board runs
// from a near-white plain to a dark crag, and a chain of one colour would be lost
// on one end of that range or the other — the pair reads on both. The dark ring is
// also what cuts the link in front out of the link behind it, which is what keeps
// two overlapping rings from fusing into one outline.
function ChainRing({ link }: { link: ChainLink }) {
  const ry = link.standing ? LINK_RY_STANDING : LINK_RY_FLAT;

  return (
    <>
      <ellipse className={styles.halo} cx={link.x.toFixed(2)} rx={LINK_RX.toFixed(2)} ry={ry.toFixed(2)} />
      <ellipse className={styles.link} cx={link.x.toFixed(2)} rx={LINK_RX.toFixed(2)} ry={ry.toFixed(2)} />
    </>
  );
}

export { FormationLayer };
