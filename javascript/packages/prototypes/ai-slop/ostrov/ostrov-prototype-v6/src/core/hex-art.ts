import deadHexArt from "../assets/hex-buildings/dead.png";
import farmHexArt from "../assets/hex-buildings/farm.png";
import masonsGuildHexArt from "../assets/hex-buildings/masons-guild.png";
import mineHexArt from "../assets/hex-buildings/mine.png";
import observatoryHexArt from "../assets/hex-buildings/observatory.png";
import sawmillHexArt from "../assets/hex-buildings/sawmill.png";
import strongholdHexArt from "../assets/hex-buildings/stronghold.png";
import universityHexArt from "../assets/hex-buildings/university.png";
import villageHexArt from "../assets/hex-buildings/village.png";

/**
 * The sprites the island canvas draws on hexes: 256x256 PNGs with alpha. They
 * repeat the designs of the 64px icons in `icons.ts`, drawn at a size that stays
 * sharp at any zoom. Only the island canvas uses them. Panels, tooltips and
 * modals keep the 64px icons.
 *
 * Every sprite shares one isometric angle and one base: a scorched oval disk
 * across the lower part of the frame. So every building sits on a hex the same way.
 */
const HEX_ART = {
  dead: deadHexArt,
  farm: farmHexArt,
  masonsGuild: masonsGuildHexArt,
  mine: mineHexArt,
  observatory: observatoryHexArt,
  sawmill: sawmillHexArt,
  stronghold: strongholdHexArt,
  university: universityHexArt,
  village: villageHexArt,
} as const;

type THexArtId = keyof typeof HEX_ART;

export type { THexArtId };
export { HEX_ART };
