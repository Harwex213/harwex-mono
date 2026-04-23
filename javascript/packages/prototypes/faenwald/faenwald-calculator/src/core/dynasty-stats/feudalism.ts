import { TTitle } from "../constants/titles.js";
import { TRace } from "../constants/race.js";

type TDynastyVassal = {
  name: string;
  emblemId: string;
  title: TTitle;
};

type TDynastyFeudalism = {
  /** Which titles player does have at the time */
  titles: Record<TTitle, number>;

  race: TRace;

  /** TBD */
  imperialTitle: null;

  /** > 0 */
  imperialPoints: number;

  vassals: TDynastyVassal[];
};
