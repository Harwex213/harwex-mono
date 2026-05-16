import fs from "fs/promises";

type THouse = {
  id: number;
  name: string;
};

type TKnight = {
  id: number;
  houseId: number;
  name: string;
  pointsAllocation: TPointsAllocation;
  askPointsAllocationEveryClash: boolean;
  isLeader: boolean;
  healthState: "health" | "lightInjury" | "heavyInjury" | "death";
};

type TPointsAllocation = {
  name: string;
  bonusPoints: TBonusPoints[];
  attackLeg: number;
  attackArm: number;
  attackBody: number;
  defenseLeg: number;
  defenseArm: number;
  defenseBody: number;
};

type TBonusPoints = {
  amount: number;
  source: string;
};

type TClashState = "pendingPointsAllocation" | "pendingDices" | "pendingFinalDices" | "pendingInjuriesCalculation" | "pendingDicesK2" | "finished";

type TClash = {
  id: number;
  state: TClashState;
  knightOne: number;
  knightTwo: number;
  winner: "one" | "two";
  pointsAllocation: TPointsAllocation;
  nextClash: number | null;
  knightOnePreviousClash: number | null;
  knightTwoPreviousClash: number | null;
  rounds: TClashRound[];
};

type TClashRound = {
  knightOneStats: TClashKnightStats;
  knightTwoStats: TClashKnightStats;
  isFinished: boolean;
};

type TClashKnightStats = {
  attackDice: number;
  directionDice: number;
  finalDice: number;
};

type TTournament = {
  houses: Record<string, THouse>;
  knights: Record<string, TKnight>;
};

const calculateFinalDice = () => {

};

const decideKnightInjury = () => {

};

const setClashPointsAllocation = () => {

};

const loadKnights = async (tournament: TTournament): Promise<void> => {
  const houses = fs.readFile("../data/houses.json");
};

const main = () => {
  const tournament: TTournament = {
    houses: {},
    knights: {},
  }

};
