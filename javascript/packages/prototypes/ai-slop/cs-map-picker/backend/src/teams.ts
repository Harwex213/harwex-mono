import { readFileSync } from "node:fs";

type TTeam = {
  id: string;
  name: string;
  players: string[];
};

const TEAMS_FILE = new URL("../assets/teams.json", import.meta.url);

// Read on every call: an edited teams.json shows up without a restart.
const loadTeams = (): TTeam[] => {
  return JSON.parse(readFileSync(TEAMS_FILE, "utf8")) as TTeam[];
};

const findTeam = (id: string) => {
  return loadTeams().find((team) => team.id === id);
};

export type { TTeam };
export { loadTeams, findTeam };
