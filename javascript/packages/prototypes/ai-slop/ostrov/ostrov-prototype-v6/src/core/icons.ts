import archerIcon from "../assets/icons/archer.png";
import armyIcon from "../assets/icons/army.png";
import batIcon from "../assets/icons/bat.png";
import buildingIcon from "../assets/icons/building.png";
import cavalryIcon from "../assets/icons/cavalry.png";
import checkIcon from "../assets/icons/check.png";
import closeIcon from "../assets/icons/close.png";
import coinIcon from "../assets/icons/coin.png";
import crowIcon from "../assets/icons/crow.png";
import deadIcon from "../assets/icons/dead.png";
import demolishIcon from "../assets/icons/demolish.png";
import farmIcon from "../assets/icons/farm.png";
import foodIcon from "../assets/icons/food.png";
import greatEagleIcon from "../assets/icons/great-eagle.png";
import griffinIcon from "../assets/icons/griffin.png";
import halberdierIcon from "../assets/icons/halberdier.png";
import hammersIcon from "../assets/icons/hammers.png";
import knightIcon from "../assets/icons/knight.png";
import leechIcon from "../assets/icons/leech.png";
import longbowmanIcon from "../assets/icons/longbowman.png";
import madIcon from "../assets/icons/mad.png";
import manaIcon from "../assets/icons/mana.png";
import masonsGuildIcon from "../assets/icons/masons-guild.png";
import militiaIcon from "../assets/icons/militia.png";
import mineIcon from "../assets/icons/mine.png";
import mothIcon from "../assets/icons/moth.png";
import musketeerIcon from "../assets/icons/musketeer.png";
import observatoryIcon from "../assets/icons/observatory.png";
import ogreIcon from "../assets/icons/ogre.png";
import poisonIcon from "../assets/icons/poison.png";
import populationIcon from "../assets/icons/population.png";
import powerIcon from "../assets/icons/power.png";
import sawmillIcon from "../assets/icons/sawmill.png";
import scienceIcon from "../assets/icons/science.png";
import scoutingIcon from "../assets/icons/scouting.png";
import skeletonIcon from "../assets/icons/skeleton.png";
import slingerIcon from "../assets/icons/slinger.png";
import spearmanIcon from "../assets/icons/spearman.png";
import spiderIcon from "../assets/icons/spider.png";
import stoneIcon from "../assets/icons/stone.png";
import strongholdIcon from "../assets/icons/stronghold.png";
import swordsmanIcon from "../assets/icons/swordsman.png";
import technologyIcon from "../assets/icons/technology.png";
import toxicityIcon from "../assets/icons/toxicity.png";
import universityIcon from "../assets/icons/university.png";
import vampireIcon from "../assets/icons/vampire.png";
import villageIcon from "../assets/icons/village.png";
import witchIcon from "../assets/icons/witch.png";
import wolfIcon from "../assets/icons/wolf.png";
import woodIcon from "../assets/icons/wood.png";
import zombieIcon from "../assets/icons/zombie.png";

/**
 * Every pictogram of the game: 64x64 PNGs with alpha, one shared style. The UI
 * draws them through the `Icon` component and the battle canvas through
 * `drawImage`, so no emoji is left in the interface.
 */
const ICONS = {
  archer: archerIcon,
  army: armyIcon,
  bat: batIcon,
  building: buildingIcon,
  cavalry: cavalryIcon,
  check: checkIcon,
  close: closeIcon,
  coin: coinIcon,
  crow: crowIcon,
  dead: deadIcon,
  demolish: demolishIcon,
  farm: farmIcon,
  food: foodIcon,
  greatEagle: greatEagleIcon,
  griffin: griffinIcon,
  halberdier: halberdierIcon,
  hammers: hammersIcon,
  knight: knightIcon,
  leech: leechIcon,
  longbowman: longbowmanIcon,
  mad: madIcon,
  mana: manaIcon,
  masonsGuild: masonsGuildIcon,
  militia: militiaIcon,
  mine: mineIcon,
  moth: mothIcon,
  musketeer: musketeerIcon,
  observatory: observatoryIcon,
  ogre: ogreIcon,
  poison: poisonIcon,
  population: populationIcon,
  power: powerIcon,
  sawmill: sawmillIcon,
  science: scienceIcon,
  scouting: scoutingIcon,
  skeleton: skeletonIcon,
  slinger: slingerIcon,
  spearman: spearmanIcon,
  spider: spiderIcon,
  stone: stoneIcon,
  stronghold: strongholdIcon,
  swordsman: swordsmanIcon,
  technology: technologyIcon,
  toxicity: toxicityIcon,
  university: universityIcon,
  vampire: vampireIcon,
  village: villageIcon,
  witch: witchIcon,
  wolf: wolfIcon,
  wood: woodIcon,
  zombie: zombieIcon,
} as const;

type TIconId = keyof typeof ICONS;

export type { TIconId };
export { ICONS };
